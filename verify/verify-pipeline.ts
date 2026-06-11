// 전체 파이프라인 검증 하니스 — 라이브 크롤 없이, "어려운" 합성 RawProduct를
// 실제 코드(selfHeal → mapper → bundle → validate → incremental)에 통과시켜 각 기능 동작을 증명한다.
//   · self-heal LLM은 토큰 0 mock(원본 payload에서 grounded 추출 시뮬레이션). 실 LLM e2e는 재크롤.
//   · enricher는 RuleEnricher(결정적 baseline) — category/hashtags 환각 없이 검증에 집중.
// 사용: npx tsx scripts/verify-pipeline.ts  → samples/{store}.json 생성 + 콘솔 요약.
import fs from 'node:fs';
import path from 'node:path';
import { RuleEnricher } from '../src/ai/rule.js';
import { SelfHealer } from '../src/ai/selfHeal.js';
import { mapToQuedot } from '../src/normalize/mapper.js';
import { validate, type ValidationIssue } from '../src/normalize/validate.js';
import { resolveBundlePricing } from '../src/normalize/bundle.js';
import { planIncremental, buildCache, groupByProduct } from '../src/normalize/incremental.js';
import type { RawProduct } from '../src/adapters/types.js';
import type { NormalizedProduct } from '../src/normalize/schema.js';
import type { PriceInfo } from '../src/adapters/types.js';

const enricher = new RuleEnricher();

// ── self-heal용 mock LLM ─────────────────────────────────────────────
// SelfHealer가 보낸 args에서 payload+요청필드를 꺼내, 원본 JSON에서 값을 "찾아" 반환(grounded 시뮬).
//   실제 LLM이 구조 바뀐 원본에서 필드를 찾는 일을 재현. 숫자도 문자열로 반환(askLLM 계약).
function findVal(payload: string, field: string): string | null {
  let obj: any;
  try {
    obj = JSON.parse(payload);
  } catch {
    return null;
  }
  const isPrice = /price|amount|consumerPrice/i.test(field);
  const preferred = isPrice
    ? ['salePrice', 'price', 'consumerPrice', 'amount']
    : ['name', 'goodsName', 'displayName', 'productName', 'title'];
  const keyRe = isPrice ? /(price|amount|won|fee)/i : /(name|title|nm|goods)/i;
  let found: string | number | null = null;

  // 1차: 선호 키 정확 일치
  const exact = (o: any) => {
    if (found != null || o == null || typeof o !== 'object') return;
    for (const k of preferred) {
      if (k in o) {
        const v = o[k];
        if (isPrice && typeof v === 'number' && v > 0) return void (found = v);
        if (!isPrice && typeof v === 'string' && v.trim().length >= 2) return void (found = v);
      }
    }
    for (const v of Object.values(o)) {
      if (found != null) break;
      if (Array.isArray(v)) v.forEach(exact);
      else if (typeof v === 'object') exact(v);
    }
  };
  // 2차: 정규식 키 매칭
  const fuzzy = (o: any) => {
    if (found != null || o == null) return;
    if (Array.isArray(o)) return o.forEach(fuzzy);
    if (typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (found != null) break;
      if (keyRe.test(k)) {
        if (isPrice && typeof v === 'number' && v > 0) found = v;
        else if (!isPrice && typeof v === 'string' && v.trim().length >= 2) found = v;
      }
    }
    for (const v of Object.values(o)) fuzzy(v);
  };
  exact(obj);
  if (found == null) fuzzy(obj);
  return found == null ? null : String(found);
}

const mockOpenAI = (): any => ({
  chat: {
    completions: {
      create: async (args: any) => {
        const content: string = args.messages[1].content;
        const m = content.match(/원본 payload:\n([\s\S]*?)\n\n추출할/);
        const payload = m ? m[1] : '{}';
        const fields: string[] = args.response_format.json_schema.schema.required;
        const out: Record<string, string | null> = {};
        for (const f of fields) out[f] = findVal(payload, f);
        return { choices: [{ message: { content: JSON.stringify(out) } }] };
      },
    },
  },
});
const healer = new SelfHealer(mockOpenAI(), { fields: ['name', 'consumerPrice'] });

// ── 어려운 합성 픽스처 ───────────────────────────────────────────────
interface Fixture {
  raw: RawProduct;
  proves: string; // 이 샘플이 증명하는 기능
  // 검증용: "LLM이 근거 없이 USP를 지어낸" 상황을 시뮬레이션(룰 baseline은 환각을 안 만들어 가드 발동 X).
  //   validate가 basis.usp=false인데 usp가 있으면 무효화하는지 확인.
  simulateHallucinatedUsp?: string;
}

const SAMPLES_DIR = path.resolve('samples');

// STORE A: 네이버 스마트스토어 (유아 건강/식품)
const storeA = 'https://smartstore.naver.com/phytonutri';
const fixturesA: Fixture[] = [
  {
    proves: '3축 옵션 펼침 + 추가금 반영 + meta.optionAxisCount=3 (큐닷 2칸 제약 추적)',
    raw: {
      productNo: 'A1', name: '피토뉴트리 키즈 멀티비타민', brandName: '피토뉴트리',
      representativeImage: 'https://img/a1.jpg', consumerPrice: 25000, salePrice: 19900,
      categoryPath: '식품>건강식품>어린이건강식품', sellerTags: ['키즈비타민', '멀티비타민'],
      optionAxes: ['맛', '용량', '수량'],
      optionCombos: [
        { names: ['딸기', '60정', '1개'], addPrice: 0 },
        { names: ['포도', '120정', '2개'], addPrice: 8000 },
        { names: ['오렌지', '120정', '3개'], addPrice: 15000, soldOut: true },
      ],
      sourceUrl: storeA + '/products/A1',
    },
  },
  {
    proves: '★자가복구: 상품명 추출 실패(name=null) → 원본의 다른 키(goodsName)에서 LLM 복구 → ai-recovery',
    raw: {
      productNo: 'A2', name: null /* 추출 실패 */, brandName: '피토뉴트리',
      representativeImage: 'https://img/a2.jpg', consumerPrice: 32000, salePrice: 28000,
      categoryPath: '식품>건강식품>유산균', sellerTags: ['유아유산균'],
      optionCombos: [{ names: ['30포'], addPrice: 0 }],
      // 결정적 파서가 보던 d.name이 사라지고 productInfo.goodsName으로 이동한 상황(구조 변경)
      rawPayload: JSON.stringify({ id: 'A2', productInfo: { goodsName: '피토뉴트리 키즈 프로바이오틱스 30포', brandName: '피토뉴트리' }, salePrice: 32000 }),
      sourceUrl: storeA + '/products/A2',
    },
  },
  {
    proves: '품절: 상품 단위 soldOut=true (옵션 없는 단일상품도 감지)',
    raw: {
      productNo: 'A3', name: '피토뉴트리 초유 단백질 (품절)', brandName: '피토뉴트리',
      representativeImage: 'https://img/a3.jpg', consumerPrice: 45000, salePrice: 45000,
      categoryPath: '식품>건강식품', sellerTags: ['초유'], soldOut: true,
      optionCombos: [], sourceUrl: storeA + '/products/A3',
    },
  },
  {
    proves: '단일 축 옵션 → 결정적(deterministic) 옵션 provenance (LLM 미사용, 환각 차단)',
    raw: {
      productNo: 'A4', name: '피토뉴트리 키즈 오메가3', brandName: '피토뉴트리',
      representativeImage: 'https://img/a4.jpg', consumerPrice: 28000, salePrice: 22000,
      categoryPath: '식품>건강식품>어린이건강식품>오메가3', sellerTags: ['키즈오메가3'],
      optionAxes: ['용량'],
      optionCombos: [
        { names: ['1개월분'], addPrice: 0 },
        { names: ['3개월분'], addPrice: 12000 },
      ],
      sourceUrl: storeA + '/products/A4',
    },
  },
];

// STORE B: 네이버 브랜드스토어 (유아 생활)
const storeB = 'https://brand.naver.com/kefii';
const fixturesB: Fixture[] = [
  {
    proves: '★자가복구: 정가 추출 실패(consumerPrice=null) → 원본 숫자에서 grounded 복구 + 양수 sanity',
    raw: {
      productNo: 'B1', name: '케피 버블클렌저 3개입', brandName: '케피',
      representativeImage: 'https://img/b1.jpg', consumerPrice: null /* 추출 실패 */, salePrice: 18300,
      categoryPath: '출산/육아>유아바디', sellerTags: ['버블클렌저', '유아바디워시'],
      optionCombos: [{ names: ['핑크+옐로우+퍼플'], addPrice: 0 }],
      rawPayload: JSON.stringify({ id: 'B1', name: '케피 버블클렌저 3개입', priceInfo: { salePrice: 32700, discounted: 18300 } }),
      sourceUrl: storeB + '/products/B1',
    },
  },
  {
    proves: '묶음(골라담기 N+M) → bundle 2-pass 가격 보정 시도',
    raw: {
      productNo: 'B2', name: '케피 골라담기 5+2 (7개)', brandName: '케피',
      representativeImage: 'https://img/b2.jpg', consumerPrice: 115010, salePrice: 89900,
      categoryPath: '출산/육아>유아바디', sellerTags: ['골라담기'],
      optionCombos: [{ names: ['버블클렌저x5', '로션x2'], addPrice: 0 }],
      sourceUrl: storeB + '/products/B2',
    },
  },
  {
    proves: '2축 옵션(색상×구성) — base 옵션 + 추가금 SKU 펼침',
    raw: {
      productNo: 'B3', name: '케피 입욕제 세트', brandName: '케피',
      representativeImage: 'https://img/b3.jpg', consumerPrice: 24000, salePrice: 19000,
      categoryPath: '출산/육아>목욕용품', sellerTags: ['입욕제'],
      optionAxes: ['향', '구성'],
      optionCombos: [
        { names: ['라벤더', '5개입'], addPrice: 0 },
        { names: ['카모마일', '10개입'], addPrice: 9000 },
      ],
      sourceUrl: storeB + '/products/B3',
    },
  },
];

// STORE C: 고도몰 공식몰 (유아 의류)
const storeC = 'https://m.happylandmall.com/';
const fixturesC: Fixture[] = [
  {
    proves: '고도몰 2축(색상:사이즈) + 추가금',
    raw: {
      productNo: 'C1', name: '해피랜드 신생아 우주복', brandName: '해피랜드',
      representativeImage: 'https://img/c1.jpg', consumerPrice: 39000, salePrice: 39000,
      categoryPath: '신생아>외출복', sellerTags: [],
      optionAxes: ['색상', '사이즈'],
      optionCombos: [
        { names: ['아이보리', '60'], addPrice: 0 },
        { names: ['핑크', '70'], addPrice: 2000 },
      ],
      sourceUrl: storeC + 'goods/C1',
    },
  },
  {
    proves: '★환각 차단: 근거(태그·본문·카테고리) 전무인데 LLM이 USP를 지어냄 → validate가 null로 무효화',
    simulateHallucinatedUsp: '아기 피부를 촉촉하게 지켜주는 최고의 보습 특가 상품!',
    raw: {
      productNo: 'C2', name: '특가상품', brandName: null,
      representativeImage: 'https://img/c2.jpg', consumerPrice: 9900, salePrice: 9900,
      categoryPath: null, sellerTags: [], detailText: null,
      optionCombos: [], sourceUrl: storeC + 'goods/C2',
    },
  },
  {
    proves: '정상 단일상품 (대조군) — 결정적 필드 + rule baseline AI',
    raw: {
      productNo: 'C3', name: '해피랜드 유아 논슬립 양말 3족', brandName: '해피랜드',
      representativeImage: 'https://img/c3.jpg', consumerPrice: 12000, salePrice: 9900,
      categoryPath: '유아>잡화>양말', sellerTags: ['논슬립양말', '유아양말'],
      optionCombos: [], sourceUrl: storeC + 'goods/C3',
    },
  },
];

// ── 처리 파이프라인 (라이브 main.ts와 동일 순서) ─────────────────────
async function processStore(storeUrl: string, storeName: string, fixtures: Fixture[]) {
  const rows: NormalizedProduct[] = [];
  const healLog: string[] = [];
  for (const fx of fixtures) {
    const hr = await healer.heal(fx.raw); // 1) 자가복구 (빈 핵심필드만)
    for (const r of hr.recovered) healLog.push(`${fx.raw.productNo}: ${r.field} 복구 "${String(r.value).slice(0, 24)}" (conf ${r.confidence})`);
    const nps = await mapToQuedot(fx.raw, storeUrl, enricher); // 2) 정규화
    if (fx.simulateHallucinatedUsp) {
      // LLM이 근거 없이 USP를 생성한 상황 주입 → validate가 막는지 확인
      for (const np of nps) {
        np.data.usp = fx.simulateHallucinatedUsp;
        np.provenance.usp = { method: 'ai', source: '시뮬레이션: 근거 없이 LLM이 USP 생성(환각)' };
      }
    }
    rows.push(...nps);
  }
  const bundle = resolveBundlePricing(rows); // 3) 묶음 보정
  const issues: ValidationIssue[][] = rows.map(validate); // 4) 검증(단일 관문)

  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  fs.writeFileSync(path.join(SAMPLES_DIR, `${storeName}.json`), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(SAMPLES_DIR, `${storeName}.cache.json`), JSON.stringify(buildCache(storeName, rows), null, 2));
  return { rows, healLog, bundle, issues };
}

function countRecovered(rows: NormalizedProduct[]): number {
  return rows.filter((r) => Object.values(r.provenance).some((p) => p.method === 'ai-recovery')).length;
}
function countUspNulled(issues: ValidationIssue[][]): number {
  return issues.flat().filter((i) => i.type === 'usp_hallucination').length;
}

async function main() {
  console.log('═══ 전체 파이프라인 검증 (합성 hard 케이스 → 실제 코드) ═══\n');

  const A = await processStore(storeA, 'phytonutri', fixturesA);
  const B = await processStore(storeB, 'kefii', fixturesB);
  const C = await processStore(storeC, 'happylandmall', fixturesC);

  // 기능별 증명 요약
  console.log('▼ 스토어별 결과');
  for (const [name, r] of [['phytonutri', A], ['kefii', B], ['happylandmall', C]] as const) {
    const products = new Set(r.rows.map((x) => x.meta.productNo)).size;
    const soldOut = r.rows.filter((x) => x.meta.soldOut).length;
    const ax3 = r.rows.filter((x) => x.meta.optionAxisCount === 3).length;
    console.log(`  • ${name}: 상품 ${products} / SKU ${r.rows.length} | 자가복구 ${countRecovered(r.rows)}SKU · 품절 ${soldOut} · 3축 ${ax3} · 묶음매칭 ${r.bundle.matched}/${r.bundle.bundles} · USP환각차단 ${countUspNulled(r.issues)}`);
    for (const h of r.healLog) console.log(`      🔧 ${h}`);
  }

  // ── 증분 재크롤 시나리오 (STORE A) ───────────────────────────────
  console.log('\n▼ 증분 재크롤 시나리오 (phytonutri)');
  const prevRows = A.rows;
  const prevCache = buildCache('phytonutri', prevRows);
  const prevByProduct = groupByProduct(prevRows);
  // 다음날: A1 가격변경(19900→17900), A2~A4 그대로, A5 신규
  const ids = ['A1', 'A2', 'A3', 'A4', 'A5'];
  const currentPrices = new Map<string, PriceInfo>([
    ['A1', { consumerPrice: 25000, salePrice: 17900 }], // 판매가 변경
    ['A2', { consumerPrice: 32000, salePrice: 28000 }], // 동일 (A2는 base=min SKU가)
    ['A3', { consumerPrice: 45000, salePrice: 45000 }],
    ['A4', { consumerPrice: 28000, salePrice: 22000 }],
    ['A5', { consumerPrice: 15000, salePrice: 15000 }], // 신규
  ]);
  const plan = planIncremental(ids, currentPrices, prevCache, prevByProduct);
  console.log(`  diff → 재크롤 ${plan.fresh.length} [${plan.fresh.join(',')}] (사유: ${plan.fresh.map((id) => plan.reasons[id]).join(',')}) · 재사용 ${plan.reuse.length} [${plan.reuse.join(',')}]`);
  console.log(`  ✓ 변경(A1)·신규(A5)만 무거운 재크롤, A2~A4는 이전 결과 재사용 → 비싼 작업(상세·OCR·자가복구·최저가) 생략`);

  // 검증 단언 (이 시나리오가 의도대로 동작하는지)
  const assert = (c: boolean, m: string) => console.log(`  ${c ? '✓' : '✗ FAIL'} ${m}`);
  assert(plan.fresh.includes('A1') && plan.reasons['A1'] === 'price-changed', 'A1 = 가격변경 → 재크롤');
  assert(plan.fresh.includes('A5') && plan.reasons['A5'] === 'new', 'A5 = 신규 → 재크롤');
  assert(plan.reuse.length === 3 && !plan.fresh.includes('A2'), 'A2~A4 = 변경없음 → 재사용');
  assert(countRecovered(A.rows) >= 1, '자가복구(A2 name)가 실제 ai-recovery로 기록됨');
  assert(countRecovered(B.rows) >= 1, '자가복구(B1 price)가 실제 ai-recovery로 기록됨');
  assert(countUspNulled(C.issues) >= 1, '환각 차단(C2 USP null)이 실제 발동됨');

  console.log(`\n✓ 샘플 저장: ${path.relative(process.cwd(), SAMPLES_DIR)}/{phytonutri,kefii,happylandmall}.json (+.cache.json)`);
  console.log('  → 각 파일을 열어 data·provenance(method)·meta(recovered/soldOut/optionAxisCount)를 직접 확인 가능');
}
main().catch((e) => {
  console.error('검증 실패:', e);
  process.exit(1);
});
