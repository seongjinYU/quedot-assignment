import type { QualityReport } from "@/lib/types";

function Readout({
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
          : "text-ink";
  return (
    <div className="border-l border-rule px-4 py-3 first:border-l-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
        {label}
      </div>
      <div className={`mt-1 font-mono text-2xl font-medium tnum ${toneCls}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-ink-soft">{hint}</div>
      ) : null}
    </div>
  );
}

export function QualitySummary({ quality }: { quality: QualityReport | null }) {
  if (!quality) return null;

  const issues = quality.validationIssues;
  const ai = quality.aiUsage;
  const fillEntries = Object.entries(quality.fillRate ?? {});

  return (
    <section className="space-y-4">
      {/* 계기판 */}
      <div className="grid grid-cols-2 border border-rule bg-panel sm:grid-cols-3 lg:grid-cols-5">
        <Readout
          label="원상품"
          value={quality.totalProducts}
          hint={`SKU ${quality.totalRows}건 펼침`}
        />
        <Readout label="SKU 행" value={quality.totalRows} />
        <Readout
          label="AI 보강 / 룰폴백"
          value={ai ? `${ai.enriched} / ${ai.ruleFallback}` : "—"}
          hint="비정형(category·hashtags·usp)만 · 룰=AI 실패 시 폴백"
        />
        <Readout
          label="검증 오류"
          value={issues?.error ?? 0}
          tone={issues && issues.error > 0 ? "danger" : "good"}
          hint="환각·범위 위반 차단"
        />
        <Readout
          label="검수 권장"
          value={issues?.warn ?? 0}
          tone={issues && issues.warn > 0 ? "warn" : "good"}
          hint="통과 처리 · 확인 권장"
        />
      </div>

      {/* 채움률 */}
      <div className="border border-rule bg-panel">
        <div className="border-b border-rule px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
          Fill Rate · 필드별 채움률
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          {fillEntries.map(([field, info]) => {
            const pct = parseFloat(info.rate);
            const barTone =
              pct >= 99
                ? "bg-emerald-500"
                : pct > 0
                  ? "bg-amber-400"
                  : "bg-stone-300";
            return (
              <div key={field} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate font-mono text-[11px] text-ink-soft">
                  {field}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-200/70">
                  <span
                    className={`block h-full rounded-full ${barTone}`}
                    style={{ width: info.rate }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] tnum text-ink-soft">
                  {info.rate}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {quality.emptyReasons &&
      Object.keys(quality.emptyReasons).length > 0 ? (
        <div className="border border-rule bg-paper">
          <div className="border-b border-rule px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
            공란 사유 · 지어내지 않고 비운 값
          </div>
          <ul className="space-y-1 px-4 py-3">
            {Object.entries(quality.emptyReasons).map(([reason, n]) => (
              <li
                key={reason}
                className="flex gap-2 text-[11px] leading-snug text-ink-soft"
              >
                <span className="shrink-0 font-mono tnum text-stone-400">
                  ×{n}
                </span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
