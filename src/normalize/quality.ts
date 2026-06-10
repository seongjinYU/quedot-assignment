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
  validationIssues: { error: number; warn: number; byField: Record<string, number> };
  aiUsage: { enriched: number; ruleFallback: number };
}

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

  // 검증 이슈 집계
  const vi = { error: 0, warn: 0, byField: {} as Record<string, number> };
  for (const issues of allIssues) {
    for (const i of issues) {
      if (i.level === 'error') vi.error++;
      else vi.warn++;
      vi.byField[i.field] = (vi.byField[i.field] ?? 0) + 1;
    }
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
  for (const [f, c] of Object.entries(q.validationIssues.byField)) console.log(`  - ${f}: ${c}건`);
  console.log(`\n[AI 사용] openai enrich ${q.aiUsage.enriched}행 / rule fallback ${q.aiUsage.ruleFallback}행`);
  if (Object.keys(q.emptyReasons).length) {
    console.log(`\n[주요 공란 사유 Top]`);
    Object.entries(q.emptyReasons).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .forEach(([r, c]) => console.log(`  (${c}) ${r}`));
  }
}
