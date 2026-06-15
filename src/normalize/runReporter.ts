// 실행 기록(run-log) 포착 — opt-in. `RUN_LOG` 환경변수가 있을 때만 동작한다.
//   목적: /demo 페이지가 "실제 크롤의 단계·로그·타이밍"을 그대로 재생할 수 있게,
//         console 출력을 가로채 타임라인 이벤트로 기록 → output/{store}.run.json.
//   기본 크롤 동작·콘솔 출력은 전혀 바뀌지 않는다(미설정 시 완전 no-op).

import fs from 'node:fs';
import path from 'node:path';

// 파이프라인 단계(흐름도 B와 1:1). 로그 줄 패턴으로 경계를 자동 감지하고,
// 로그가 없는 단계(extract·validate)는 main.ts가 mark()로 명시한다.
export type StageId =
  | 'input'
  | 'adapter'
  | 'login'
  | 'list'
  | 'price'
  | 'extract'
  | 'category'
  | 'ai'
  | 'bundle'
  | 'lowest'
  | 'validate'
  | 'output';

// 로그 줄 → 단계 매핑 (위에서부터 첫 매치). 매치 없으면 직전 단계를 상속.
const STAGE_RULES: { re: RegExp; stage: StageId }[] = [
  { re: /어댑터:/, stage: 'adapter' },
  { re: /로그인/, stage: 'login' },
  { re: /목록 전수/, stage: 'list' },
  { re: /가격 배치 조회/, stage: 'price' },
  // 런타임 줄만(이모지 접두). "자가복구: ON" 같은 시작 설정 줄은 제외 → input에 남김.
  { re: /🔤 OCR|🔧 자가복구|♻️ 증분/, stage: 'extract' },
  { re: /스토어 카테고리/, stage: 'category' },
  { re: /────|매핑 실패/, stage: 'ai' },
  { re: /묶음 보정/, stage: 'bundle' },
  { re: /최저가/, stage: 'lowest' },
  { re: /✓ 저장|품질 리포트/, stage: 'output' },
];

export interface RunEvent {
  t: number; // ms, 시작 기준 상대
  stage: StageId;
  line: string;
  level: 'log' | 'error' | 'mark';
}

export interface RunLog {
  store: string;
  url: string;
  startedAt: string;
  durationMs: number;
  totals: Record<string, number>;
  stages: StageId[]; // 발생 순서(중복 제거)
  events: RunEvent[];
}

// 라이브 스트림 센티넬 — 로컬 SSE 엔드포인트가 이 접두 줄만 골라 브라우저로 중계한다.
export const STREAM_PREFIX = '__QD_EVENT__';
export const STREAM_DONE = '__QD_DONE__';

export class RunReporter {
  readonly enabled: boolean;
  private stream: boolean;
  private t0 = Date.now();
  private events: RunEvent[] = [];
  private totals: Record<string, number> = {};
  private current: StageId = 'input';
  private seen = new Set<StageId>();
  private origLog?: typeof console.log;
  private origErr?: typeof console.error;
  private store = '';
  private url = '';

  constructor() {
    this.enabled = !!process.env.RUN_LOG;
    this.stream = !!process.env.RUN_STREAM; // 라이브: 이벤트를 stdout 센티넬로도 방출
  }

  // console.log/error를 가로채 원본 호출 + 타임라인 기록을 동시에 한다.
  start(url: string): void {
    if (!this.enabled) return;
    this.url = url;
    this.t0 = Date.now();
    this.push('input', 'URL 입력', 'mark');
    this.origLog = console.log;
    this.origErr = console.error;
    console.log = (...a: unknown[]) => {
      this.capture(this.fmt(a), 'log');
      this.origLog!(...a);
    };
    console.error = (...a: unknown[]) => {
      this.capture(this.fmt(a), 'error');
      this.origErr!(...a);
    };
  }

  setStore(store: string): void {
    this.store = store;
  }

  // 로그 줄이 없는 단계 경계(추출·검증)를 명시. 콘솔에는 찍지 않는다.
  mark(stage: StageId, note: string): void {
    if (!this.enabled) return;
    this.push(stage, note, 'mark');
  }

  meta(totals: Record<string, number>): void {
    if (!this.enabled) return;
    Object.assign(this.totals, totals);
  }

  // 콘솔 복원 + run.json 기록.
  finish(outDir: string): void {
    if (!this.enabled) return;
    if (this.origLog) console.log = this.origLog;
    if (this.origErr) console.error = this.origErr;
    const log: RunLog = {
      store: this.store,
      url: this.url,
      startedAt: new Date(this.t0).toISOString(),
      durationMs: Date.now() - this.t0,
      totals: this.totals,
      stages: [...this.seen],
      events: this.events,
    };
    const p = path.join(outDir, `${this.store}.run.json`);
    fs.writeFileSync(p, JSON.stringify(log, null, 2));
    if (this.stream)
      process.stdout.write(`${STREAM_DONE}${JSON.stringify({ totals: log.totals, store: log.store })}\n`);
    this.origLog?.(`\n✓ 실행 기록(run-log): ${p} (${this.events.length}이벤트)`);
  }

  private capture(line: string, level: 'log' | 'error'): void {
    const trimmed = line.replace(/\n+$/, '');
    if (!trimmed.trim()) return;
    // 여러 줄 로그는 줄 단위로 분해해 각각 단계 매핑(가독성)
    for (const ln of trimmed.split('\n')) {
      const stage = this.detect(ln) ?? this.current;
      this.push(stage, ln, level);
    }
  }

  private detect(line: string): StageId | null {
    for (const { re, stage } of STAGE_RULES) if (re.test(line)) return stage;
    return null;
  }

  private push(stage: StageId, line: string, level: 'log' | 'error' | 'mark'): void {
    this.current = stage;
    this.seen.add(stage);
    const ev: RunEvent = { t: Date.now() - this.t0, stage, line, level };
    this.events.push(ev);
    // 라이브 스트림: console.log 패치와 무관하게 process.stdout 으로 직접 센티넬 방출.
    if (this.stream) process.stdout.write(`${STREAM_PREFIX}${JSON.stringify(ev)}\n`);
  }

  private fmt(args: unknown[]): string {
    return args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
  }
}
