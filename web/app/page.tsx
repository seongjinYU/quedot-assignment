import Link from "next/link";
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
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-14 sm:py-20">
      {/* 마스트헤드 */}
      <header className="mb-12">
        <div className="rise flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-soft">
          <span>Quedot</span>
          <span className="h-px w-8 bg-ink-soft" />
          <span>Provenance Ledger</span>
        </div>

        <p
          className="rise mt-6 max-w-2xl text-[15px] leading-relaxed text-ink-soft"
          style={{ animationDelay: "120ms" }}
        >
          브랜드 스토어 전 상품 크롤링 → AI 정규화 결과입니다. 모든 필드는{" "}
          <span className="font-medium text-ink">출처(provenance)</span>가
          추적되어 — 원본 그대로인지, AI가 생성·복구했는지, 정직하게 비웠는지를
          한눈에 검수합니다.
        </p>

        <Link
          href="/demo"
          className="rise mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 font-mono text-[12px] tracking-wide text-paper transition-opacity hover:opacity-85"
          style={{ animationDelay: "150ms" }}
        >
          ▶ 파이프라인 데모 보기
        </Link>

        <div
          className="rule-wipe mt-8 h-px w-full bg-ink/80"
          style={{ animationDelay: "180ms" }}
        />

        <dl
          className="rise mt-4 flex flex-wrap gap-x-10 gap-y-2 font-mono text-xs text-ink-soft"
          style={{ animationDelay: "220ms" }}
        >
          <Stat k="STORES" v={stores.length} />
          <Stat k="PRODUCTS" v={totals.products} />
          <Stat k="SKU ROWS" v={totals.rows} />
        </dl>
      </header>

      {/* 도시에 그리드 */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((s, i) => (
          <div
            key={s.slug}
            className="rise"
            style={{ animationDelay: `${280 + i * 70}ms` }}
          >
            <StoreCard store={s} index={i} />
          </div>
        ))}
      </div>
    </main>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="tracking-[0.14em]">{k}</dt>
      <dd className="tnum text-base font-medium text-ink">{v}</dd>
    </div>
  );
}
