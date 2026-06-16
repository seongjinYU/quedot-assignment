'use client';

// 데모 단일 엔진 — 라이브(실제 크롤 SSE)와 재생(run.json)을 같은 상태 싱크로 흘린다.
//  - 라이브: 로컬 /api/crawl SSE → 실제 크롤이 도는 대로 이벤트 수신.
//  - 재생: run.json을 '단계별' 페이싱으로 흘림 — 단계마다 최소 노출 + 로그 캡(상품 수 무관 ~18s, 배포 폴백).
// 두 경우 모두 {stage,line,level} 이벤트를 push() 해 로그·흐름도·카운터를 갱신한다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { STAGE_DEFS, type RunLog, type RunEvent, type StageId } from './demo';

export interface EngineLine {
  i: number;
  stage: StageId;
  line: string;
  level: RunEvent['level'];
}
export interface EngineState {
  lines: EngineLine[];
  activeStage: StageId | null;
  counters: { products: number; sku: number; lowest: number };
  mode: 'idle' | 'live' | 'replay';
  running: boolean;
  done: boolean;
  error: string | null;
}

// 재생 페이싱 — '단계(stage)별' 균등 노출. 이전엔 이벤트 균등이라 로그 많은 단계(목록·추출)가
//   상품 수에 비례해 길어지고 최저가·검증·출력은 끝에 0.1초씩 뭉쳤다 → 단계마다 고정 노출.
//   결과적으로 총 재생 길이가 '상품 수'가 아니라 '단계 수'로 결정돼 일정하다(~18초).
const STAGE_DWELL = 1500;        // 각 단계 최소 노출(ms) — 로그가 몇 줄이든 이 시간은 유지
const INTRA_GAP = 55;            // 같은 단계 내 로그 줄 간격(ms)
const STAGE_GAP = 360;           // 새 단계 진입 전 짧은 정지(노드 점등 인지용)
const MAX_LINES_PER_STAGE = 12;  // 단계당 표시 로그 상한(초과분은 "… N줄 더" 1줄로 접음)
const END_HOLD = 700;            // 마지막 단계 후 완료 표시까지 여유

// 한 단계의 로그가 너무 많으면(추출·매핑 등 상품 수만큼) 앞·뒤만 보이고 가운데는 요약 한 줄로 접는다.
function capSegment(evs: RunEvent[]): RunEvent[] {
  if (evs.length <= MAX_LINES_PER_STAGE) return evs;
  const head = evs.slice(0, MAX_LINES_PER_STAGE - 4);
  const tail = evs.slice(-3);
  const omitted = evs.length - head.length - tail.length;
  const note: RunEvent = { ...head[head.length - 1], line: `   … (${omitted}줄 더 — 같은 단계 반복)`, level: 'mark' };
  return [...head, note, ...tail];
}

const empty = (): EngineState => ({
  lines: [],
  activeStage: null,
  counters: { products: 0, sku: 0, lowest: 0 },
  mode: 'idle',
  running: false,
  done: false,
  error: null,
});

export function useDemoEngine() {
  const [state, setState] = useState<EngineState>(empty);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const es = useRef<EventSource | null>(null);
  // push 누적 상태(렌더와 분리)
  const acc = useRef({ i: 0, products: 0, sku: 0, lowest: 0, lines: [] as EngineLine[] });

  const teardown = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    es.current?.close();
    es.current = null;
  }, []);

  const reset = useCallback(() => {
    teardown();
    acc.current = { i: 0, products: 0, sku: 0, lowest: 0, lines: [] };
    setState(empty());
  }, [teardown]);

  const applyEvent = useCallback((ev: RunEvent, mode: 'live' | 'replay') => {
    const a = acc.current;
    a.lines.push({ i: a.i++, stage: ev.stage, line: ev.line, level: ev.level });
    if (a.lines.length > 400) a.lines = a.lines.slice(-400);
    const ln = ev.line.trim();
    if (/^─+ 상품/.test(ln) || /상품 \d+ \(옵션/.test(ev.line)) a.products += 1;
    if (/^•/.test(ln)) a.sku += 1;
    const m = ev.line.match(/채움\s+(\d+)/);
    if (m) a.lowest = Number(m[1]);
    setState((s) => ({
      ...s,
      mode,
      running: true,
      lines: a.lines.slice(),
      activeStage: ev.stage,
      counters: { products: a.products, sku: a.sku, lowest: a.lowest },
    }));
  }, []);

  const finalize = useCallback((totals?: Record<string, number>) => {
    const a = acc.current;
    setState((s) => ({
      ...s,
      running: false,
      done: true,
      counters: {
        products: totals?.products ?? a.products,
        sku: totals?.sku ?? a.sku,
        lowest: totals?.lowestResolved ?? a.lowest,
      },
    }));
  }, []);

  // 재생(run.json) — '단계별' 페이싱. 각 단계가 이벤트 수와 무관하게 최소 STAGE_DWELL 노출되고,
  //   로그 많은 단계는 capSegment로 접어 총 길이가 상품 수와 무관하게 일정하다.
  const startReplay = useCallback(
    (run: RunLog) => {
      reset();
      if (!run.events.length) return;

      // 1) 연속 동일 stage → 세그먼트로 묶기
      const segments: { stage: StageId; events: RunEvent[] }[] = [];
      for (const ev of run.events) {
        const last = segments[segments.length - 1];
        if (last && last.stage === ev.stage) last.events.push(ev);
        else segments.push({ stage: ev.stage, events: [ev] });
      }

      // 2) 평탄화: step마다 '직전 대비 지연(delay)' + 세그먼트 끝 hold(부족한 노출시간 보충)
      const steps: { ev: RunEvent; delay: number; holdAfter: number }[] = [];
      for (const seg of segments) {
        const evs = capSegment(seg.events);
        evs.forEach((ev, idx) =>
          steps.push({ ev, delay: idx === 0 ? STAGE_GAP : INTRA_GAP, holdAfter: 0 })
        );
        const innerTime = STAGE_GAP + (evs.length - 1) * INTRA_GAP;
        const hold = STAGE_DWELL - innerTime;
        if (hold > 0) steps[steps.length - 1].holdAfter = hold; // 짧은 단계는 마지막 줄에서 hold
      }

      // 3) 스케줄 실행 (delay = 직전 step 이후 대기, holdAfter = 단계 노출 보충)
      let i = 0;
      const tick = () => {
        applyEvent(steps[i].ev, 'replay');
        const cur = steps[i];
        i += 1;
        if (i < steps.length) timer.current = setTimeout(tick, steps[i].delay + cur.holdAfter);
        else timer.current = setTimeout(() => finalize(run.totals), cur.holdAfter + END_HOLD);
      };
      timer.current = setTimeout(tick, steps[0].delay);
    },
    [reset, applyEvent, finalize]
  );

  // 라이브(실제 크롤 SSE)
  const startLive = useCallback(
    (slug: string, limit: number) => {
      reset();
      setState((s) => ({ ...s, mode: 'live', running: true }));
      const source = new EventSource(`/api/crawl?store=${encodeURIComponent(slug)}&limit=${limit}`);
      es.current = source;
      source.onmessage = (e) => {
        try { applyEvent(JSON.parse(e.data) as RunEvent, 'live'); } catch {}
      };
      source.addEventListener('done', (e) => {
        let totals: Record<string, number> | undefined;
        try { totals = JSON.parse((e as MessageEvent).data).totals; } catch {}
        finalize(totals);
        source.close();
        es.current = null;
      });
      source.addEventListener('failed', (e) => {
        let msg = '크롤 실행에 실패했습니다.';
        try { msg = JSON.parse((e as MessageEvent).data).message || msg; } catch {}
        setState((s) => ({ ...s, running: false, error: msg }));
        source.close();
        es.current = null;
      });
      source.onerror = () => {
        // 정상 종료(done) 후에도 onerror가 올 수 있어, 아직 done이 아니면만 에러 처리
        setState((s) => (s.done ? s : { ...s, running: false, error: s.error ?? '연결이 끊겼습니다.' }));
        source.close();
        es.current = null;
      };
    },
    [reset, applyEvent, finalize]
  );

  useEffect(() => () => teardown(), [teardown]);

  // 라이브 진행 중 활성 단계로 progress 추정(흐름도용은 activeStage로 충분)
  void STAGE_DEFS;

  return { state, startReplay, startLive, reset };
}
