'use client';

// 왼쪽 패널 — 터미널풍 로그. 포착된 실제 로그 줄이 스트리밍되며 자동 스크롤.
import { useEffect, useRef } from 'react';
import { GROUP_COLOR, STAGE_DEF } from '@/lib/demo';
import type { EngineLine } from '@/lib/useDemoEngine';

export function LogStream({ lines, running }: { lines: EngineLine[]; running: boolean }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // 로그 컨테이너만 맨 아래로 — scrollIntoView는 window까지 끌어 전체 화면이 스크롤되므로 쓰지 않는다.
    const c = endRef.current?.parentElement;
    if (c) c.scrollTop = c.scrollHeight;
  }, [lines]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#1d2742] bg-[#0c1322]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-[12px] tracking-wide text-white/45">
          crawl — npm run crawl
        </span>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 font-mono text-[13.5px] leading-relaxed">
        {lines.length === 0 && (
          <div className="text-white/35">$ 분석을 시작하면 실행 로그가 여기에 흐릅니다…</div>
        )}
        {lines.map((l) => {
          const color = GROUP_COLOR[STAGE_DEF[l.stage].group];
          const err = l.level === 'error';
          return (
            <div key={l.i} className="flex gap-2 whitespace-pre-wrap break-words py-[1px]">
              <span
                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: color }}
              />
              <span style={{ color: err ? '#ff8a8e' : 'rgba(233,240,252,0.92)' }}>
                {l.line}
              </span>
            </div>
          );
        })}
        {running && (
          <div className="mt-1 inline-block h-4 w-2 animate-pulse bg-white/70 align-middle" />
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
