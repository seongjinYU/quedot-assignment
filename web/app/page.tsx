import { getIndex } from "@/lib/data";
import { StoreCard } from "@/components/StoreCard";

export default function HomePage() {
  const { stores } = getIndex();

  const totals = stores.reduce(
    (acc, s) => {
      acc.products += s.totalProducts ?? 0;
      acc.rows += s.totalRows;
      return acc;
    },
    { products: 0, rows: 0 }
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          큐닷 정규화 결과 뷰어
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
          브랜드 스토어 전 상품 크롤링 → AI 정규화 결과입니다. 모든 필드는{" "}
          <span className="font-medium text-slate-700">출처(provenance)</span>가
          추적되어, 원본 그대로인지 · AI가 생성·복구했는지 · 정직하게 비웠는지를
          한눈에 검수할 수 있습니다.
        </p>
        <div className="mt-4 flex gap-6 text-xs text-slate-400">
          <span>
            스토어{" "}
            <span className="font-semibold text-slate-700">
              {stores.length}
            </span>
            개
          </span>
          <span>
            원상품{" "}
            <span className="font-semibold text-slate-700">
              {totals.products}
            </span>
            개
          </span>
          <span>
            SKU{" "}
            <span className="font-semibold text-slate-700">{totals.rows}</span>행
          </span>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((s) => (
          <StoreCard key={s.slug} store={s} />
        ))}
      </div>
    </main>
  );
}
