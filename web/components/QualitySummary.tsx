import type { QualityReport } from "@/lib/types";

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "good"
          ? "text-emerald-600"
          : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>
        {value}
      </div>
      {hint ? <div className="text-[11px] text-slate-400">{hint}</div> : null}
    </div>
  );
}

/** 스토어 품질 리포트(quality.json) 요약 */
export function QualitySummary({ quality }: { quality: QualityReport | null }) {
  if (!quality) return null;

  const issues = quality.validationIssues;
  const ai = quality.aiUsage;
  const fillEntries = Object.entries(quality.fillRate ?? {});

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="원상품 수"
          value={quality.totalProducts}
          hint={`SKU ${quality.totalRows}건으로 펼침`}
        />
        <Stat label="SKU(행) 수" value={quality.totalRows} />
        <Stat
          label="AI 보강 / 룰 폴백"
          value={ai ? `${ai.enriched} / ${ai.ruleFallback}` : "—"}
          hint="비정형(category·hashtags·usp)"
        />
        <Stat
          label="검증 오류"
          value={issues?.error ?? 0}
          tone={issues && issues.error > 0 ? "danger" : "good"}
          hint="환각·범위 위반 차단"
        />
        <Stat
          label="검증 경고"
          value={issues?.warn ?? 0}
          tone={issues && issues.warn > 0 ? "warn" : "good"}
          hint={
            issues?.byField
              ? Object.entries(issues.byField)
                  .map(([f, n]) => `${f}:${n}`)
                  .join(" ")
              : undefined
          }
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-slate-500">
          필드별 채움률
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {fillEntries.map(([field, info]) => {
            const pct = parseFloat(info.rate);
            const barTone =
              pct >= 99
                ? "bg-emerald-500"
                : pct > 0
                  ? "bg-amber-400"
                  : "bg-slate-200";
            return (
              <div key={field} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[11px] text-slate-600">
                  {field}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className={`block h-full ${barTone}`}
                    style={{ width: info.rate }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
                  {info.rate}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {quality.emptyReasons &&
      Object.keys(quality.emptyReasons).length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1 text-xs font-semibold text-slate-500">
            공란 사유 (지어내지 않고 비운 값)
          </div>
          <ul className="space-y-0.5">
            {Object.entries(quality.emptyReasons).map(([reason, n]) => (
              <li key={reason} className="text-[11px] text-slate-600">
                <span className="font-medium tabular-nums text-slate-400">
                  ×{n}
                </span>{" "}
                {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
