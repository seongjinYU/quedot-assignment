// 정제 품질 수치화 — 산출물의 신뢰도를 숫자로 증명
// "정제했다"(X) → "필드별 채움률 X%, 못 채운 N건은 이런 유형"(O)
import type { NormalizedProduct, PartnerProductCreateInput } from './schema.js';
import type { ValidationIssue } from './validate.js';

const FIELDS: (keyof PartnerProductCreateInput)[] = [
  'brand_name', 'name', 'image_url', 'option1', 'option2',
  'consumer_price', 'sales_price', 'lowest_price', 'discount_rate',
  'hashtags', 'usp', 'category_group',
];

export interface QualityReport {
  store: string;
  totalProducts: number; // 원상품(옵션 펼침 전)
  totalRows: number; // SKU(옵션 펼침 후)
  fillRate: Record<string, { filled: number; rate: string; method: Record<string, number> }>;
  emptyReasons: Record<string, number>; // 공란 사유별 집계
  // 검증 이슈: 필드별 + 유형별(실패 유형 분류)
  validationIssues: { error: number; warn: number; byField: Record<string, number>; byType: Record<string, number> };
  // 옵션 구조 통계 (엣지케이스 가시화)
  options: {
    soldOut: number; // 품절 SKU
    singleProduct: number; // 옵션 없는 단일상품 SKU
    axis1: number; // 1축 옵션
    axis2: number; // 2축 옵션
    axis3plus: number; // 3축+ (큐닷 2칸 제약 → option2 결합 사례)
  };
  aiUsage: { enriched: number; ruleFallback: number };
}

// 이슈 유형 → 사람이 읽는 라벨
const ISSUE_TYPE_LABEL: Record<string, string> = {
  usp_hallucination: 'USP 환각 차단',
  category_enum: '카테고리 7종 외 제거',
  category_lowconf: '카테고리 저신뢰 축소',
  option_cleanup: '옵션 텍스트 정리',
  price_invalid: '비정상 가격 무효화',
  price_inverted: '판매가>정가',
  discount_range: '할인율 범위 밖',
  discount_uncomputable: '할인율 계산 불가',
  hashtag_cleanup: '해시태그 정리',
  missing_name: '상품명 누락',
  missing_image: '대표이미지 누락',
};

function isFilled(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

export function buildQualityReport(
  store: string,
  rows: NormalizedProduct[],
  allIssues: ValidationIssue[][],
): QualityReport {
  const productNos = new Set(rows.map((r) => r.meta.productNo));
  const fillRate: QualityReport['fillRate'] = {};
  const emptyReasons: Record<string, number> = {};

  for (const f of FIELDS) {
    let filled = 0;
    const method: Record<string, number> = {};
    for (const r of rows) {
      if (isFilled(r.data[f])) filled++;
      const m = r.provenance[f]?.method ?? 'unknown';
      method[m] = (method[m] ?? 0) + 1;
      // 공란 사유 집계
      if (r.provenance[f]?.method === 'empty' && r.provenance[f]?.reason) {
        const key = `${f}: ${r.provenance[f].reason}`;
        emptyReasons[key] = (emptyReasons[key] ?? 0) + 1;
      }
    }
    fillRate[f] = {
      filled,
      rate: rows.length ? ((filled / rows.length) * 100).toFixed(1) + '%' : '0%',
      method,
    };
  }

  // 검증 이슈 집계 (필드별 + 유형별)
  const vi = { error: 0, warn: 0, byField: {} as Record<string, number>, byType: {} as Record<string, number> };
  for (const issues of allIssues) {
    for (const i of issues) {
      if (i.level === 'error') vi.error++;
      else vi.warn++;
      vi.byField[i.field] = (vi.byField[i.field] ?? 0) + 1;
      const t = (i as { type?: string }).type ?? 'unknown';
      vi.byType[t] = (vi.byType[t] ?? 0) + 1;
    }
  }

  // 옵션 구조 통계 (품절·축수 — 엣지케이스 가시화)
  const options = { soldOut: 0, singleProduct: 0, axis1: 0, axis2: 0, axis3plus: 0 };
  for (const r of rows) {
    if (r.meta.soldOut) options.soldOut++;
    const ac = r.meta.optionAxisCount;
    if (ac == null) options.singleProduct++;
    else if (ac >= 3) options.axis3plus++;
    else if (ac === 2) options.axis2++;
    else options.axis1++;
  }

  // AI 사용 집계 (enrich된 행 vs fallback)
  let enriched = 0;
  let ruleFallback = 0;
  for (const r of rows) {
    const src = r.provenance.category_group?.source ?? '';
    if (src.includes('openai')) enriched++;
    else if (src.includes('rule')) ruleFallback++;
  }

  return {
    store,
    totalProducts: productNos.size,
    totalRows: rows.length,
    fillRate,
    emptyReasons,
    validationIssues: vi,
    options,
    aiUsage: { enriched, ruleFallback },
  };
}

/** 사람이 읽는 요약 출력 */
export function printQualityReport(q: QualityReport): void {
  console.log(`\n══════ 정제 품질 리포트: ${q.store} ══════`);
  console.log(`원상품 ${q.totalProducts}개 → SKU ${q.totalRows}건 (옵션 펼침)`);
  console.log(`\n[필드별 채움률]`);
  for (const [f, info] of Object.entries(q.fillRate)) {
    const methods = Object.entries(info.method).map(([m, c]) => `${m}:${c}`).join(' ');
    console.log(`  ${f.padEnd(15)} ${info.rate.padStart(6)} (${info.filled}/${q.totalRows})  [${methods}]`);
  }
  console.log(`\n[검증 이슈] error ${q.validationIssues.error} / warn ${q.validationIssues.warn}`);
  console.log(`  [유형별]`);
  Object.entries(q.validationIssues.byType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([t, c]) => console.log(`    ${(ISSUE_TYPE_LABEL[t] ?? t).padEnd(18)} ${c}건`));

  const o = q.options;
  console.log(`\n[옵션 구조] 단일상품 ${o.singleProduct} / 1축 ${o.axis1} / 2축 ${o.axis2} / 3축+ ${o.axis3plus} / 품절 ${o.soldOut}`);
  if (o.axis3plus > 0) console.log(`  ⚠️ 3축+ ${o.axis3plus}건: 큐닷 option1/2(2칸) 제약 → option2에 결합`);

  console.log(`\n[AI 사용] openai enrich ${q.aiUsage.enriched}행 / rule fallback ${q.aiUsage.ruleFallback}행`);
  if (Object.keys(q.emptyReasons).length) {
    console.log(`\n[주요 공란 사유 Top]`);
    Object.entries(q.emptyReasons).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .forEach(([r, c]) => console.log(`  (${c}) ${r}`));
  }
}
