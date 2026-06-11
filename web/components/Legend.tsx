import {
  METHOD_META,
  METHOD_ORDER,
  PLACEMENT_STYLE,
  type MethodStyle,
} from "@/lib/provenance";

/** provenance 색 코딩 범례 — 검수의 "읽는 법" */
export function Legend() {
  // 표시 순서: 기본 method + "AI 배치"(ai 바로 뒤에 삽입)
  const items: MethodStyle[] = [];
  for (const method of METHOD_ORDER) {
    items.push(METHOD_META[method]);
    if (method === "ai") items.push(PLACEMENT_STYLE);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-slate-500">
        필드 출처(provenance) 색 코딩 — 무채색=신뢰, 유채색=검수 대상
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {items.map((m) => (
          <li key={m.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
            <span className="text-xs font-medium text-slate-700">{m.label}</span>
            <span className="text-xs text-slate-400">{m.desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
