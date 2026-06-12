import Link from "next/link";
import type { StoreIndexEntry } from "@/lib/types";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function StoreCard({
  store,
  index,
}: {
  store: StoreIndexEntry;
  index: number;
}) {
  const imgs = store.sampleImages.slice(0, 4);
  return (
    <Link
      href={`/store/${store.slug}`}
      className="group relative block border border-ink/15 bg-panel transition-colors hover:border-ink"
    >
      {/* 스탬프 인덱스 */}
      <span className="pointer-events-none absolute right-3 top-2 font-mono text-[11px] tabular-nums text-ink-soft">
        № {String(index + 1).padStart(2, "0")}
      </span>

      {/* 이미지 스트립 */}
      <div className="grid aspect-[16/10] grid-cols-4 gap-px border-b border-rule bg-rule">
        {imgs.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            className="h-full w-full bg-panel object-cover grayscale-[0.15] transition duration-500 group-hover:grayscale-0"
          />
        ))}
        {imgs.length === 0 ? (
          <div className="col-span-4 flex items-center justify-center font-mono text-xs text-ink-soft">
            no image
          </div>
        ) : null}
      </div>

      <div className="p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-2xl font-semibold leading-none tracking-tight text-ink">
            {store.store}
          </h3>
          {store.recoveredRows > 0 ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-mono text-[10px] font-medium text-red-600 ring-1 ring-inset ring-red-200">
              확인필요 {store.recoveredRows}
            </span>
          ) : null}
        </div>

        <dl className="mt-4 space-y-0 border-t border-rule font-mono text-xs">
          <Row k="상품 / SKU" v={`${store.totalProducts ?? "—"} / ${store.totalRows}`} />
          <Row
            k="AI 보강"
            v={store.aiUsage ? `${store.aiUsage.enriched}건` : "—"}
          />
          <Row
            k="오류 / 검수권장"
            v={
              store.validationIssues
                ? `${store.validationIssues.error} / ${store.validationIssues.warn}`
                : "—"
            }
          />
          <Row k="수집일" v={fmtDate(store.crawledAt)} />
        </dl>

        <div className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-transform group-hover:translate-x-0.5">
          검수 테이블 열기
          <span aria-hidden>→</span>
        </div>
      </div>
    </Link>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-rule/60 py-1.5">
      <dt className="text-ink-soft">{k}</dt>
      <dd className="tnum text-ink">{v}</dd>
    </div>
  );
}
