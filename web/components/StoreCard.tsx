import Link from "next/link";
import type { StoreIndexEntry } from "@/lib/types";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function StoreCard({ store }: { store: StoreIndexEntry }) {
  const imgs = store.sampleImages.slice(0, 4);
  return (
    <Link
      href={`/store/${store.slug}`}
      className="group block overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="grid aspect-[16/9] grid-cols-2 gap-px bg-slate-100">
        {imgs.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            className="h-full w-full bg-white object-cover"
          />
        ))}
        {imgs.length === 0 ? (
          <div className="col-span-2 flex items-center justify-center text-xs text-slate-400">
            이미지 없음
          </div>
        ) : null}
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 group-hover:text-slate-700">
            {store.store}
          </h3>
          {store.recoveredRows > 0 ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600 ring-1 ring-inset ring-red-200">
              확인필요 {store.recoveredRows}
            </span>
          ) : null}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
          <dt className="text-slate-400">상품 / SKU</dt>
          <dd className="text-right font-medium tabular-nums text-slate-700">
            {store.totalProducts ?? "—"} / {store.totalRows}
          </dd>
          <dt className="text-slate-400">AI 보강</dt>
          <dd className="text-right font-medium tabular-nums text-slate-700">
            {store.aiUsage ? `${store.aiUsage.enriched}건` : "—"}
          </dd>
          <dt className="text-slate-400">검증 오류 / 경고</dt>
          <dd className="text-right font-medium tabular-nums text-slate-700">
            {store.validationIssues
              ? `${store.validationIssues.error} / ${store.validationIssues.warn}`
              : "—"}
          </dd>
          <dt className="text-slate-400">수집일</dt>
          <dd className="text-right font-medium tabular-nums text-slate-700">
            {fmtDate(store.crawledAt)}
          </dd>
        </dl>

        <div className="mt-3 text-xs font-medium text-violet-600 group-hover:underline">
          검수 테이블 열기 →
        </div>
      </div>
    </Link>
  );
}
