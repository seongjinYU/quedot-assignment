'use client';

// 데모 단일 엔진 — 라이브(실제 크롤 SSE)와 재생(run.json)을 같은 상태 싱크로 흘린다.
//  - 라이브: 로컬 /api/crawl SSE → 실제 크롤이 도는 대로 이벤트 수신.
//  - 재생: run.json 이벤트를 인덱스 균등 페이싱(~22s)으로 흘림(배포 폴백).
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

const TARGET_MS = 22000;
const MIN_INTERVAL = 45;
const MAX_INTERVAL = 170;

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

  // 재생(run.json) — 인덱스 균등 페이싱
  const startReplay = useCallback(
    (run: RunLog) => {
      reset();
      const events = run.events;
      const n = events.length;
      if (!n) return;
      const interval = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, TARGET_MS / n));
      let i = 0;
      const step = () => {
        applyEvent(events[i], 'replay');
        i += 1;
        if (i < n) timer.current = setTimeout(step, interval);
        else finalize(run.totals);
      };
      timer.current = setTimeout(step, 200);
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
