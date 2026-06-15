'use client';

// flow-B 상세 흐름도를 Mermaid로 렌더하고, 재생 단계에 맞춰 노드를 점등한다.
// Mermaid는 1회만 렌더(비쌈) → 이후엔 노드 DOM에 클래스만 토글.
import { useEffect, useRef, useState } from 'react';
import { MERMAID_DEF, nodeSets } from '@/lib/flowchart';
import type { StageId } from '@/lib/demo';

const HILITE_CSS = `
.qd-flow .node { transition: opacity .3s ease; }
.qd-flow .qd-dim { opacity: .3; }
.qd-flow .qd-done, .qd-flow .qd-active { opacity: 1; }
.qd-flow .qd-active > rect, .qd-flow .qd-active > polygon, .qd-flow .qd-active > circle {
  stroke-width: 4px !important;
  filter: drop-shadow(0 0 9px rgba(45,107,255,.85));
}
.qd-flow .qd-active .nodeLabel, .qd-flow .qd-active span.nodeLabel { font-weight: 800 !important; }
.qd-flow svg { max-width: 100%; height: auto; }
.qd-flow .nodeLabel, .qd-flow span.nodeLabel { font-family: 'IBM Plex Sans KR', system-ui, sans-serif !important; }
.qd-flow .nodeLabel b, .qd-flow span.nodeLabel b { font-weight: 800; }
.qd-flow .edgeLabel, .qd-flow .edgeLabel span { font-size: 11.5px !important; color: #5E6E85 !important; background: #FAFCFF !important; }
`;

// 활성 노드를 '흐름도 스크롤 컨테이너' 안에서만 가운데로 이동시킨다.
// scrollIntoView는 window를 포함한 모든 스크롤 조상을 움직여 전체 화면까지 스크롤되므로,
// 가장 가까운 스크롤 컨테이너의 scrollTop만 직접 조정한다(페이지는 건드리지 않음).
function scrollParentToCenter(el: Element): void {
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) break;
    p = p.parentElement;
  }
  if (!p) return;
  const pr = p.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const delta = er.top - pr.top - p.clientHeight / 2 + er.height / 2;
  p.scrollTo({ top: p.scrollTop + delta, behavior: 'smooth' });
}

export function FlowchartB({
  isNaver,
  stagesOrder,
  activeStage,
  optional,
}: {
  isNaver: boolean;
  stagesOrder: StageId[];
  activeStage: StageId | null;
  optional: Set<string>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const nodeMap = useRef<Map<string, Element>>(new Map());
  const [ready, setReady] = useState(false);

  // 1회 렌더
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          fontFamily: 'IBM Plex Sans KR, system-ui, sans-serif',
          fontSize: '14px',
          lineColor: '#B9C6DC',
          primaryColor: '#EAF1FF',
          primaryBorderColor: '#2D6BFF',
          primaryTextColor: '#0B1220',
          edgeLabelBackground: '#FAFCFF',
        },
        flowchart: { curve: 'basis', htmlLabels: true, nodeSpacing: 40, rankSpacing: 50, useMaxWidth: true },
      });
      const { svg } = await mermaid.render('qd-flow-svg', MERMAID_DEF);
      if (cancelled || !hostRef.current) return;
      hostRef.current.innerHTML = svg;
      // 노드 id(flowchart-<NODE>-<idx>) → 엘리먼트 매핑
      nodeMap.current.clear();
      // mermaid 노드 id 형식: "<renderId>-flowchart-<NODE>-<idx>"
      hostRef.current.querySelectorAll('.node').forEach((el) => {
        const m = el.id.match(/flowchart-([A-Za-z]+)-\d+$/);
        if (m) nodeMap.current.set(m[1], el);
      });
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // 단계 변화 → 점등
  useEffect(() => {
    if (!ready) return;
    const { active, done } = nodeSets(stagesOrder, activeStage, isNaver, optional);
    let activeEl: Element | null = null;
    nodeMap.current.forEach((el, id) => {
      el.classList.remove('qd-active', 'qd-done', 'qd-dim');
      if (active.has(id)) { el.classList.add('qd-active'); if (!activeEl) activeEl = el; }
      else if (done.has(id)) el.classList.add('qd-done');
      else el.classList.add('qd-dim');
    });
    if (activeEl) scrollParentToCenter(activeEl as Element);
  }, [ready, stagesOrder, activeStage, isNaver, optional]);

  return (
    <div className="qd-flow px-2 py-3">
      <style>{HILITE_CSS}</style>
      <div ref={hostRef} />
      {!ready && (
        <div className="flex h-40 items-center justify-center text-[13px] text-[#9AA8BD]">
          흐름도 준비 중…
        </div>
      )}
    </div>
  );
}
