// 빌드 시점(SSG)에 web/data/ 를 읽는 서버 전용 로더.
// data/ 는 prebuild(sync-data.mjs)가 생성한다.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalizedProduct, QualityReport, StoreIndex } from './types';

const dataDir = join(process.cwd(), 'data');

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
