// 빌드 시점(SSG)에 web/data/ 를 읽는 서버 전용 로더.
// data/ 는 prebuild(sync-data.mjs)가 생성한다.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalizedProduct, QualityReport, StoreIndex } from './types';

const dataDir = join(process.cwd(), 'data');
const runsDir = join(process.cwd(), 'public', 'runs');

export interface DemoStore {
  slug: string;
  store: string;
  url: string;
  products: number;
  sku: number;
  lowest: number;
  image: string | null;
  hasRun: boolean; // 실행 기록(run.json) 보유 — 없으면 재크롤 필요
}

// 과제 대상 3개 스토어 — run 유무와 무관하게 퀵픽에 항상 노출한다.
const TARGETS: { slug: string; url: string }[] = [
  { slug: 'kefii', url: 'https://brand.naver.com/kefii' },
  { slug: 'phytonutri', url: 'https://smartstore.naver.com/phytonutri' },
  { slug: 'happylandmall', url: 'https://m.happylandmall.com/' },
];

/** /demo 퀵픽용 — 대상 3개 스토어 메타 + 실행 기록 보유 여부(hasRun). */
export function getDemoStores(): DemoStore[] {
  const index = getIndex();
  const bySlug = new Map(index.stores.map((s) => [s.slug, s]));
  return TARGETS.filter((t) => bySlug.has(t.slug)).map((t) => {
    const idx = bySlug.get(t.slug)!;
    const runPath = join(runsDir, `${t.slug}.run.json`);
    const hasRun = existsSync(runPath);
    const run = hasRun ? JSON.parse(readFileSync(runPath, 'utf8')) : null;
    return {
      slug: t.slug,
      store: idx.store ?? t.slug,
      url: t.url,
      products: run?.totals?.products ?? idx.totalProducts ?? 0,
      sku: run?.totals?.sku ?? idx.totalRows ?? 0,
      lowest: run?.totals?.lowestResolved ?? 0,
      image: idx.sampleImages?.[0] ?? null,
      hasRun,
    };
  });
}

export function getIndex(): StoreIndex {
  return JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8'));
}

export function getStore(slug: string): {
  products: NormalizedProduct[];
  quality: QualityReport | null;
} {
  const products = JSON.parse(
    readFileSync(join(dataDir, `${slug}.json`), 'utf8')
  ) as NormalizedProduct[];

  let quality: QualityReport | null = null;
  try {
    quality = JSON.parse(
      readFileSync(join(dataDir, `${slug}.quality.json`), 'utf8')
    );
  } catch {
    quality = null;
  }

  return { products, quality };
}
