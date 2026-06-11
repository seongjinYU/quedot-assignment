// 증분 재크롤 순수 로직 검증 — 네트워크 없이 결정적 테스트.
import { planIncremental, buildCache, groupByProduct } from '../src/normalize/incremental.js';
import type { CrawlCache } from '../src/normalize/incremental.js';
import type { NormalizedProduct } from '../src/normalize/schema.js';
import type { PriceInfo } from '../src/adapters/types.js';

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => (c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.error(`  ✗ ${m}`)));

// 최소 NormalizedProduct 더미 (가격 시그널만 의미 있음)
const row = (pno: string, consumer: number | null, sale: number | null): NormalizedProduct =>
  ({
    data: { consumer_price: consumer, sales_price: sale } as any,
    provenance: {} as any,
    meta: { productNo: pno } as any,
  }) as NormalizedProduct;

const price = (consumer: number | null, sale: number | null): PriceInfo => ({ consumerPrice: consumer, salePrice: sale });

function run() {
  // 이전 결과: A(정상), B(정상). 캐시도 동일.
  const prevRows = [row('A', 10000, 8000), row('B', 20000, 20000)];
  const prevByProduct = groupByProduct(prevRows);
  const prevCache: CrawlCache = {
    store: 's',
    updatedAt: 'x',
    products: { A: { consumerPrice: 10000, salePrice: 8000 }, B: { consumerPrice: 20000, salePrice: 20000 } },
  };

  // 현재 목록: A(가격 동일), B(판매가 변경 20000→18000), C(신규). → fresh=[B,C], reuse=[A]
  console.log('① diff: 변경없음=재사용 / 가격변경·신규=재크롤');
  {
    const ids = ['A', 'B', 'C'];
    const cur = new Map<string, PriceInfo>([
      ['A', price(10000, 8000)],
      ['B', price(20000, 18000)], // 판매가 변경
      ['C', price(30000, 30000)], // 신규
    ]);
    const plan = planIncremental(ids, cur, prevCache, prevByProduct);
    ok(plan.reuse.join(',') === 'A', `재사용 = A (${plan.reuse.join(',')})`);
    ok(plan.fresh.sort().join(',') === 'B,C', `재크롤 = B,C (${plan.fresh.join(',')})`);
    ok(plan.reasons['B'] === 'price-changed', 'B = 가격변경');
    ok(plan.reasons['C'] === 'new', 'C = 신규');
  }

  // 이전 캐시는 있지만 이전 행이 없는 상품 → 신규로 처리(재사용 불가)
  console.log('② 캐시에만 있고 이전 행 없으면 → 신규');
  {
    const cacheOnly: CrawlCache = { store: 's', updatedAt: 'x', products: { Z: { consumerPrice: 100, salePrice: 100 } } };
    const plan = planIncremental(['Z'], new Map([['Z', price(100, 100)]]), cacheOnly, new Map());
    ok(plan.fresh.join(',') === 'Z' && plan.reasons['Z'] === 'new', 'Z = 신규(행 없음)');
  }

  // 전부 변경 없음 → 전부 재사용(무거운 크롤 0)
  console.log('③ 변경 전무 → 전부 재사용');
  {
    const cur = new Map<string, PriceInfo>([['A', price(10000, 8000)], ['B', price(20000, 20000)]]);
    const plan = planIncremental(['A', 'B'], cur, prevCache, prevByProduct);
    ok(plan.fresh.length === 0 && plan.reuse.length === 2, '재크롤 0 / 재사용 2');
  }

  // buildCache: SKU 여러 개 중 최저(base) 시그널 보존
  console.log('④ buildCache: productNo별 최저 SKU가를 base로 보존');
  {
    const rows = [row('P', 12000, 10000), row('P', 15000, 13000), row('Q', 5000, 5000)];
    const cache = buildCache('s', rows);
    ok(cache.products['P'].consumerPrice === 12000, `P base consumer = 12000 (${cache.products['P'].consumerPrice})`);
    ok(cache.products['P'].salePrice === 10000, `P base sale = 10000 (${cache.products['P'].salePrice})`);
    ok(cache.products['Q'].consumerPrice === 5000, 'Q = 5000');
  }

  console.log(`\n결과: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
