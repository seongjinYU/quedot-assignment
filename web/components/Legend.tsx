import {
  METHOD_META,
  METHOD_ORDER,
  PLACEMENT_STYLE,
  type MethodStyle,
} from "@/lib/provenance";

/** provenance 색 코딩 범례 — 검수의 "읽는 법" */
export function Legend() {
  const items: MethodStyle[] = [];
  for (const method of METHOD_ORDER) {
    items.push(METHOD_META[method]);
    if (method === "ai") items.push(PLACEMENT_STYLE);
  }

  return (
    <div className="border border-rule bg-panel">
      <div className="border-b border-rule px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
        Provenance Key · 무채색=신뢰, 유채색=검수 대상
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((m) => (
          <li key={m.label} className="flex items-baseline gap-2.5">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${m.dot}`} />
            <span className="shrink-0 text-[13px] font-medium text-ink">
              {m.label}
            </span>
            <span className="text-[11px] leading-snug text-ink-soft">
              {m.desc}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
