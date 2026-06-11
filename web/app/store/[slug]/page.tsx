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

  return (
    <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-8">
      <div className="mb-4">
        <Link
          href="/"
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          ← 스토어 목록
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
          {quality?.store ?? slug}
        </h1>
      </div>

      <div className="space-y-5">
        <QualitySummary quality={quality} />
        <Legend />
        <SkuTable products={products} />
      </div>
    </main>
  );
}
