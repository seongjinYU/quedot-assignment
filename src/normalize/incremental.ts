// 증분 재크롤(incremental) — "매번 전부 다시 긁지 말고 바뀐 것만."
// 목록 + 배치가격(상세 호출 없이 싸게 확보되는 시그널)으로 이전 캐시와 diff →
//   신규/가격변경 상품만 무거운 재크롤(상세·OCR·자가복구·최저가), 나머지는 이전 결과 재사용.
// 효과: 호출 횟수 감소(크롤링 매너) + 비싼 작업(에누리 브라우저·OCR) 절약. CLAUDE.md 성능 규칙과 정합.
//
// 변경 시그널 = 가격(consumerPrice/salePrice) + 존재여부. (배치로 안 잡히는 재고 변화는
//   가격 변화에 동반되지 않으면 증분에서 놓칠 수 있음 — 가격 기반 휴리스틱, 정확도 우선 시 전수 크롤.)
import fs from 'node:fs';
import type { NormalizedProduct } from './schema.js';
import type { PriceInfo } from '../adapters/types.js';

export interface CrawlCache {
  store: string;
  updatedAt: string;
  /** productNo → base 가격 시그널(addPrice 0 옵션 ≈ 최저 SKU가) */
  products: Record<string, { consumerPrice: number | null; salePrice: number | null }>;
}

export interface IncrementalPlan {
  fresh: string[]; // 신규 or 가격변경 → 무거운 재크롤 대상
  reuse: string[]; // 변경 없음 → 이전 결과 재사용
  reasons: Record<string, 'new' | 'price-changed'>;
}

export function loadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function groupByProduct(rows: NormalizedProduct[]): Map<string, NormalizedProduct[]> {
  const m = new Map<string, NormalizedProduct[]>();
  for (const r of rows) {
    const arr = m.get(r.meta.productNo);
    if (arr) arr.push(r);
    else m.set(r.meta.productNo, [r]);
  }
  return m;
}

/** 이전 캐시(가격 시그널)와 현재 배치가격을 비교해 무거운 재크롤이 필요한 상품만 가린다. */
export function planIncremental(
  ids: string[],
  currentPrices: Map<string, PriceInfo>,
  prevCache: CrawlCache | null,
  prevRowsByProduct: Map<string, NormalizedProduct[]>,
): IncrementalPlan {
  const plan: IncrementalPlan = { fresh: [], reuse: [], reasons: {} };
  for (const id of ids) {
    const key = String(id);
    const prev = prevCache?.products[key];
    // 이전 캐시에 없거나, 재사용할 이전 행이 없으면 → 신규(무거운 크롤)
    if (!prev || !prevRowsByProduct.has(key)) {
      plan.fresh.push(key);
      plan.reasons[key] = 'new';
      continue;
    }
    const cur = currentPrices.get(key);
    const curC = cur?.consumerPrice ?? null;
    const curS = cur?.salePrice ?? null;
    if (curC !== prev.consumerPrice || curS !== prev.salePrice) {
      plan.fresh.push(key);
      plan.reasons[key] = 'price-changed';
      continue;
    }
    plan.reuse.push(key);
  }
  return plan;
}

/** 최종 결과 rows로부터 다음 증분용 캐시 생성. productNo별 base(최저 SKU) 가격 시그널만 보존. */
export function buildCache(store: string, rows: NormalizedProduct[]): CrawlCache {
  const products: CrawlCache['products'] = {};
  for (const r of rows) {
    const pno = r.meta.productNo;
    const c = r.data.consumer_price;
    const s = r.data.sales_price;
    const ex = products[pno];
    if (!ex) {
      products[pno] = { consumerPrice: c, salePrice: s };
    } else {
      if (c != null && (ex.consumerPrice == null || c < ex.consumerPrice)) ex.consumerPrice = c;
      if (s != null && (ex.salePrice == null || s < ex.salePrice)) ex.salePrice = s;
    }
  }
  return { store, updatedAt: new Date().toISOString(), products };
}
