import type { FieldProvenance, FillMethod, ProductField } from "@/lib/types";
import { getFieldDisplay } from "@/lib/provenance";

/** 작은 색점 — 셀 안에서 method 를 한 글자도 없이 표시.
 *  field 를 넘기면 옵션의 ai 는 "AI 배치"(청록)로 분리 표시한다. */
export function MethodDot({
  method,
  field,
}: {
  method: FillMethod;
  field?: ProductField;
}) {
  const m = getFieldDisplay(field, { method });
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${m.dot}`}
      title={m.label}
      aria-label={m.label}
    />
  );
}

/** 라벨이 붙은 배지 — 상세 펼침/범례에서 사용 */
export function MethodBadge({
  prov,
  field,
}: {
  prov: FieldProvenance;
  field?: ProductField;
}) {
  const m = getFieldDisplay(field, prov);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}
