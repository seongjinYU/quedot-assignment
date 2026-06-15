'use client';

// /demo 오케스트레이터 — URL 입력 + 퀵픽(대상 3개) → 라이브(실제 크롤) 또는 재생 → 검수 UI 핸드오프.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { DemoStore } from '@/lib/data';
import type { RunLog, StageId } from '@/lib/demo';
import { useDemoEngine } from '@/lib/useDemoEngine';
import { FlowchartB } from './FlowchartB';
import { LogStream } from './LogStream';

const C = {
  ink: '#0B1220', sub: '#5E6E85', faint: '#9AA8BD',
  line: '#E4EAF3', soft: '#EEF3FA', brand: '#2D6BFF',
};

const LIVE_LIMIT = 12; // 라이브 시연: 상품 12개 (최저가 표본 확보 — 6개는 1건만 잡혀 빈약)
const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

export function DemoClient({ stores }: { stores: DemoStore[] }) {
  const first = stores.find((s) => s.hasRun) ?? stores[0] ?? null;
  const [selected, setSelected] = useState<DemoStore | null>(first);
  const [urlText, setUrlText] = useState(first?.url ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [live, setLive] = useState<boolean | null>(null); // null=확인중
  const { state, startReplay, startLive, reset } = useDemoEngine();
  const startedAny = useRef(false);

  // 라이브 가능 여부 확인
  useEffect(() => {
    fetch('/api/crawl?status=1')
      .then((r) => r.json())
      .then((d) => setLive(!!d.enabled))
      .catch(() => setLive(false));
  }, []);

  const pick = useCallback((s: DemoStore) => {
    setSelected(s); setUrlText(s.url); setNotice(null); reset(); startedAny.current = false;
  }, [reset]);

  const onStart = useCallback(async () => {
    const matched = stores.find((s) => norm(s.url) === norm(urlText)) ?? selected;
    if (!matched) return;
    setSelected(matched);
    setNotice(null);
    startedAny.current = true;
    if (live) {
      startLive(matched.slug, LIVE_LIMIT); // 실제 크롤 직결(모든 스토어 가능)
      return;
    }
    if (!matched.hasRun) {
      setNotice(`${matched.store}는 실행 기록이 없습니다 — 로컬 라이브 모드(npm run dev)에서 실제 크롤로 보거나, RUN_LOG=1 재크롤이 필요합니다.`);
      startedAny.current = false;
      return;
    }
    try {
      const run: RunLog = await (await fetch(`/runs/${matched.slug}.run.json`)).json();
      startReplay(run);
    } catch {
      setNotice('실행 기록을 불러오지 못했습니다.');
      startedAny.current = false;
    }
  }, [stores, urlText, selected, live, startLive, startReplay]);

  // 흐름도 입력 — 스트리밍된 줄에서 derive (라이브/재생 공통)
  const isNaver = /naver\.com/.test(selected?.url ?? '');
  const { stagesOrder, optional } = useMemo(() => {
    const order: StageId[] = [];
    const seen = new Set<StageId>();
    const opt = new Set<string>();
    for (const l of state.lines) {
      if (!seen.has(l.stage)) { seen.add(l.stage); order.push(l.stage); }
      if (/🔤 OCR/.test(l.line)) opt.add('OCRY');
      if (/🔧 자가복구:/.test(l.line)) opt.add('HEALY');
    }
    return { stagesOrder: order, optional: opt };
  }, [state.lines]);

  const busy = state.running;
  const started = startedAny.current && state.lines.length > 0;

  return (
    <div className="relative min-h-screen w-full overflow-hidden" style={{ background: '#fff' }}>
      <div className="pointer-events-none absolute inset-0" style={{
        backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
        backgroundSize: '64px 64px', opacity: 0.4,
        maskImage: 'radial-gradient(120% 80% at 50% 0%, #000 30%, transparent 80%)',
        WebkitMaskImage: 'radial-gradient(120% 80% at 50% 0%, #000 30%, transparent 80%)',
      }} />
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(50% 36% at 86% 2%, ${C.brand}1f, transparent 70%)` }} />

      <div className="relative mx-auto w-full max-w-[1380px] px-6 py-7">
        {/* 상단바 */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-[22px] font-black tracking-tight" style={{ color: C.ink }}>
              <span className="inline-block h-3.5 w-3.5 translate-y-[1px] rounded-[5px]" style={{ background: C.brand, boxShadow: `0 0 0 5px ${C.brand}1f` }} />
              <span className="ml-2.5">큐닷</span><span className="ml-1.5 font-bold" style={{ color: C.sub }}>AX</span>
            </span>
            <ModeChip live={live} mode={state.mode} />
          </div>
          <div className="flex items-center gap-5">
            <Counter label="상품" value={state.counters.products} />
            <Counter label="SKU" value={state.counters.sku} />
            <Counter label="최저가" value={state.counters.lowest} />
          </div>
        </div>

        {/* 입력 행 */}
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-3 rounded-2xl border bg-white px-5 py-3.5" style={{ borderColor: C.line, boxShadow: '0 10px 26px -18px rgba(20,40,90,0.3)' }}>
            <span className="h-5 w-5 shrink-0 rounded-full border-[3px]" style={{ borderColor: C.brand }} />
            <input value={urlText} onChange={(e) => setUrlText(e.target.value)} spellCheck={false}
              className="w-full bg-transparent font-mono text-[16px] font-medium outline-none" style={{ color: C.ink }}
              placeholder="https://brand.naver.com/..." />
          </div>
          <button onClick={onStart} disabled={busy}
            className="shrink-0 rounded-2xl px-7 py-3.5 text-[16px] font-extrabold text-white transition-opacity disabled:opacity-55"
            style={{ background: C.brand, boxShadow: `0 14px 30px -14px ${C.brand}` }}>
            {busy ? (state.mode === 'live' ? '크롤링 중…' : '분석 중…') : state.done ? '다시 분석 ▶' : '분석 시작 ▶'}
          </button>
        </div>

        {/* 퀵픽 */}
        <div className="mb-2 flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-semibold" style={{ color: C.faint }}>퀵픽</span>
          {stores.map((s) => {
            const on = selected?.slug === s.slug;
            const needsCrawl = !live && !s.hasRun;
            return (
              <button key={s.slug} onClick={() => pick(s)}
                className="flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13.5px] font-bold transition-colors"
                style={{ borderColor: on ? C.brand : C.line, background: on ? `${C.brand}10` : '#fff', color: on ? C.brand : C.sub, opacity: needsCrawl ? 0.7 : 1 }}>
                <span className="h-2 w-2 rounded-full" style={{ background: on ? C.brand : C.faint }} />
                {s.store}
                {needsCrawl && <span className="rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ background: C.soft, color: C.faint }}>재크롤 필요</span>}
              </button>
            );
          })}
          {live && <span className="text-[12px]" style={{ color: C.faint }}>· 라이브: 상품 {LIVE_LIMIT}개 · 최저가 네이버+에누리 실조회</span>}
        </div>
        {notice && (
          <div className="mb-3 rounded-xl border px-4 py-2.5 text-[13.5px] font-medium" style={{ borderColor: '#F1D2A9', background: '#FDF6EC', color: '#9A6B1E' }}>{notice}</div>
        )}

        {/* 본문: 좌 로그 / 우 흐름도 */}
        <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="h-[64vh] min-h-[480px]">
            <LogStream lines={state.lines} running={busy} />
          </div>
          <div className="h-[64vh] min-h-[480px] overflow-y-auto overscroll-contain rounded-2xl border bg-[#FAFCFF]" style={{ borderColor: C.line }}>
            {started ? (
              <FlowchartB isNaver={isNaver} stagesOrder={stagesOrder} activeStage={state.activeStage} optional={optional} />
            ) : (
              <div className="flex h-full items-center justify-center text-center text-[14px]" style={{ color: C.faint }}>
                분석을 시작하면 상세 흐름도가 뜨고<br />단계가 순서대로 점등됩니다.
              </div>
            )}
          </div>
        </div>

        {/* 완료 CTA */}
        {state.done && selected && (
          <div className="rise mt-5 flex flex-col items-center justify-between gap-3 rounded-2xl border px-6 py-4 sm:flex-row" style={{ borderColor: `${C.brand}40`, background: `${C.brand}08` }}>
            <div className="text-[15px] font-semibold" style={{ color: C.ink }}>
              <b style={{ color: C.brand }}>{selected.store}</b> · 상품 {state.counters.products} · SKU {state.counters.sku} 정규화 완료 — 모든 값에 출처(provenance) 기록
            </div>
            <Link href={`/store/${selected.slug}`} className="rounded-xl px-6 py-3 text-[15px] font-extrabold text-white" style={{ background: C.brand, boxShadow: `0 12px 26px -14px ${C.brand}` }}>
              검수 결과 보기 →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeChip({ live, mode }: { live: boolean | null; mode: string }) {
  const isLive = live && mode !== 'replay';
  const label = live === null ? '확인 중…' : isLive ? '라이브 · 실제 크롤' : '기록 재생';
  const col = isLive ? '#16A34A' : C.brand;
  return (
    <span className="flex items-center gap-2 rounded-full px-3 py-1 text-[12.5px] font-bold"
      style={{ background: `${col}12`, color: col, border: `1px solid ${col}33` }}>
      <span className="h-2 w-2 rounded-full" style={{ background: col }} />
      {label}
    </span>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[12px] font-bold tracking-wide" style={{ color: C.faint }}>{label}</span>
      <span className="tnum text-[22px] font-black tabular-nums" style={{ color: C.brand }}>{value}</span>
    </div>
  );
}
