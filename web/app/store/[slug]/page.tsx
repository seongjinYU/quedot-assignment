import Link from "next/link";
import { notFound } from "next/navigation";
import { getIndex, getStore } from "@/lib/data";
import { QualitySummary } from "@/components/QualitySummary";
import { Legend } from "@/components/Legend";
import { SkuTable } from "@/components/SkuTable";

export const dynamicParams = false;

export function generateStaticParams() {
  return getIndex().stores.map((s) => ({ slug: s.slug }));
}

export default async function StorePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const known = getIndex().stores.find((s) => s.slug === slug);
  if (!known) notFound();

  const { products, quality } = getStore(slug);
  const crawledAt = known.crawledAt
    ? new Date(known.crawledAt).toLocaleString("ko-KR")
    : "—";

  return (
    <main className="mx-auto w-full max-w-[100rem] flex-1 px-5 py-8">
      {/* 마스트헤드 */}
      <header className="rise mb-6">
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft transition-colors hover:text-ink"
        >
          ← Ledger
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3 border-b border-ink/80 pb-3">
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink">
            {quality?.store ?? slug}
          </h1>
          <div className="font-mono text-[11px] text-ink-soft">
            수집 {crawledAt}
          </div>
        </div>
      </header>

      <div className="space-y-6">
        <QualitySummary quality={quality} />
        <Legend />
        <SkuTable products={products} />
      </div>
    </main>
  );
}
