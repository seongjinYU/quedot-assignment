// RawProduct → 큐닷 PartnerProductCreateInput 정규화 + 필드별 처리 추적(provenance)
// 옵션 조합별로 펼쳐 SKU 단위 NormalizedProduct[] 반환.
// 옵션 텍스트는 enricher가 정규화(LLM은 표시 텍스트만), 가격·식별은 원본 조합 유지.
import type { RawProduct, OptionCombo } from '../adapters/types.js';
import type { Enricher, EnrichResult, OptionNormalized } from '../ai/provider.js';
import {
  type NormalizedProduct,
  type PartnerProductCreateInput,
  type FieldProvenance,
} from './schema.js';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const empty = (reason: string): FieldProvenance => ({ method: 'empty', reason });
const det = (): FieldProvenance => ({ method: 'deterministic' });

export async function mapToQuedot(
  raw: RawProduct,
  storeUrl: string,
  enricher: Enricher,
  opts: { siteCategories?: string[] } = {},
): Promise<NormalizedProduct[]> {
  // AI enrich(category/hashtags/usp)는 상품 단위 1회. 스토어 카테고리를 함께 줘 유아/기타·도메인 판단.
  const ai = await enricher.enrich({
    name: raw.name,
    categoryPath: raw.categoryPath ?? null,
    sellerTags: raw.sellerTags ?? [],
    detailText: raw.detailText ?? null,
    siteCategories: opts.siteCategories,
  });
  const hasSite = (opts.siteCategories?.length ?? 0) > 0;

  const combos = raw.optionCombos ?? [];
  if (combos.length === 0) {
    // 옵션 없음(단일상품) 또는 주관식 입력형 옵션은 어댑터에서 제외됨 → 1건
    return [buildRow(raw, storeUrl, enricher.kind, ai, undefined, undefined, 0, 0, hasSite)];
  }

  // 옵션 텍스트 정규화 (상품당 1배치). 가격/식별은 아래에서 원본 combo 유지.
  const norms = await enricher.normalizeOptions(
    combos.map((c) => ({ names: c.names })),
    { productName: raw.name },
  );

  // 상한 없이 전수 펼침 (이커머스는 SKU 50+ 흔함). 비정상 대량만 경고.
  if (combos.length > 200) {
    console.log(`  ⚠️ 옵션 조합 ${combos.length}개 (비정상적으로 많음 — 데이터 확인 권장)`);
  }
  return combos.map((combo, i) =>
    buildRow(raw, storeUrl, enricher.kind, ai, combo, norms[i], i, combos.length, hasSite),
  );
}

function buildRow(
  raw: RawProduct,
  storeUrl: string,
  enricherKind: string,
  ai: EnrichResult,
  combo: OptionCombo | undefined,
  norm: OptionNormalized | undefined,
  optionIndex: number,
  optionTotal: number,
  hasSiteContext = false,
): NormalizedProduct {
  const prov: Record<keyof PartnerProductCreateInput, FieldProvenance> = {} as any;
  // AI 필드의 실제 근거 유무 (provenance 정직성 + validate 환각 차단의 기준)
  const hasDetailText = !!(raw.detailText && raw.detailText.trim().length > 10);
  const hasTags = (raw.sellerTags?.length ?? 0) > 0;
  const basis = {
    categoryPath: !!raw.categoryPath,
    detailText: hasDetailText,
    sellerTags: hasTags,
    // USP 근거: 상세본문 OR 태그/카테고리 OR 충분히 서술적인 상품명(15자+, 브랜드·소재·종류 포함)
    usp: hasDetailText || hasTags || !!raw.categoryPath || (!!raw.name && raw.name.trim().length >= 15),
  };

  // 자가복구로 채운 raw 필드는 'ai-recovery'로 정직 표기(결정적 추출 실패 → 원본 LLM 복구, 검수 대상).
  //   base = 정상 추출이었을 때의 provenance. 복구된 필드면 그 위에 ai-recovery로 덮어쓴다.
  const recoveredProv = (rawKey: string, base: FieldProvenance): FieldProvenance => {
    const rec = raw.recovered?.[rawKey];
    if (!rec) return base;
    const extra = base.source ? ` · ${base.source}` : '';
    return { method: 'ai-recovery', source: `결정적 추출 실패 → 원본 LLM 복구(grounded, conf ${rec.confidence})${extra}` };
  };

  // ---- 기본 식별 ----
  const brand_name = raw.brandName ?? null;
  prov.brand_name = brand_name ? det() : empty('브랜드명 없음');
  const name = raw.name ?? null;
  prov.name = name ? recoveredProv('name', det()) : empty('상품명 없음');
  const image_url = raw.representativeImage ?? null;
  prov.image_url = image_url ? det() : empty('대표 이미지 없음');

  // ---- 옵션 (정규화된 텍스트 사용 / 가격은 원본 combo) ----
  const aiSrc = enricherKind === 'rule-baseline' ? 'rule-baseline (LLM 미연동: 수식어 제거까지)' : enricherKind;
  let option1: string | null = null;
  let option2: string | null = null;
  if (combo) {
    option1 = norm?.option1 ?? null;
    option2 = norm?.option2 ?? null;
    // provenance 정직화: enricher가 알려준 실제 처리 경로(aiPlaced)를 그대로 표기한다.
    //   - aiPlaced=true  → ai: 3축+ 옵션을 LLM이 의미배치(grounded·무손실 가드 통과)
    //   - aiPlaced=false → deterministic: ≤2축 룰(위치) 또는 LLM 가드 폴백(둘 다 결정적)
    const usedLLM = norm?.aiPlaced === true;
    const optProv = (): FieldProvenance =>
      usedLLM
        ? { method: 'ai', source: `옵션 3축 의미배치(grounded 가드) / ${enricherKind}` }
        : { method: 'deterministic', source: '옵션 정규화(룰: 위치 기반·수식어 제거)' };
    prov.option1 = option1 ? optProv() : empty('옵션값 없음');
    prov.option2 = option2 ? optProv() : empty('단일 옵션 축');
  } else {
    prov.option1 = empty('옵션 없음(단일상품) 또는 주관식 입력형 제외');
    prov.option2 = empty('옵션 없음');
  }

  // ---- 가격 (옵션 추가금 반영, addPrice는 원본 유지) ----
  const addPrice = combo?.addPrice ?? 0;
  const consumer_price = raw.consumerPrice != null ? raw.consumerPrice + addPrice : null;
  prov.consumer_price =
    raw.consumerPrice != null
      ? recoveredProv(
          'consumerPrice',
          addPrice > 0 ? { method: 'calculated', source: `정가 + 옵션추가금(${addPrice})` } : det(),
        )
      : empty('정가 없음');

  const sales_price = raw.salePrice != null ? raw.salePrice + addPrice : null;
  prov.sales_price =
    raw.salePrice != null
      ? addPrice > 0
        ? { method: 'calculated', source: `판매가 + 옵션추가금(${addPrice}, 추가금엔 즉시할인 미적용 가정)` }
        : det()
      : empty('즉시할인 판매가 미확보');

  let discount_rate: number | null = null;
  if (consumer_price != null && sales_price != null && consumer_price > 0) {
    discount_rate = round1(((consumer_price - sales_price) / consumer_price) * 100);
    prov.discount_rate = { method: 'calculated' };
  } else {
    prov.discount_rate = empty('정가/판매가 미확보로 계산 불가');
  }

  // ---- 가산점: lowest_price ----
  // 초기값은 공란. 실조회(resolveLowestPrices, main.ts 2.5-pass)가 켜져 있으면 이 값을 덮어쓴다.
  const lowest_price = null;
  prov.lowest_price = empty(
    `lowest_price 미조회(NAVER 키 없음/에누리 미활성). 매칭키 syncNvMid=${raw.naverMid ?? 'N/A'}`,
  );

  // ---- AI 필드 (category/hashtags/usp) ----
  // provenance는 "실제 사용된 근거"만 정직하게 표기. 환각 차단은 validate.ts(단일 관문)가 담당.
  // detailText 출처 라벨 (OCR로 채운 경우 정직하게 구분)
  const detailLabel = raw.detailTextSource === 'ocr' ? '상세이미지OCR' : '상세본문';
  const hashtags = ai.hashtags ?? [];
  const hashtagSrc = basis.sellerTags
    ? `sellerTags+상품명 / ${aiSrc}`
    : basis.detailText
      ? `${detailLabel}+상품명 / ${aiSrc}`
      : `상품명 / ${aiSrc}`;
  prov.hashtags = hashtags.length ? { method: 'ai', source: hashtagSrc } : empty('해시태그 없음');

  const usp = ai.usp ?? null;
  const uspSrc = basis.detailText
    ? `${detailLabel} / ${aiSrc}`
    : basis.sellerTags
      ? `상품명+태그 / ${aiSrc}`
      : raw.categoryPath
        ? `상품명+카테고리 / ${aiSrc}`
        : `상품명 / ${aiSrc}`;
  prov.usp = usp ? { method: 'ai', source: uspSrc } : empty('USP 없음(근거 부족)');

  const category_group = ai.category_group ?? [];
  const catBasis = [basis.categoryPath ? '카테고리경로' : '상품명', hasSiteContext ? '스토어카테고리' : null]
    .filter(Boolean)
    .join('+');
  prov.category_group = category_group.length
    ? { method: 'ai', source: `${catBasis} / ${aiSrc}` }
    : empty('카테고리 분류 실패');

  const data: PartnerProductCreateInput = {
    brand_name, name, image_url, option1, option2,
    consumer_price, sales_price, lowest_price, discount_rate,
    hashtags, usp, category_group,
  };

  return {
    data,
    provenance: prov,
    meta: {
      storeUrl,
      productNo: raw.productNo,
      naverMid: raw.naverMid ?? null,
      crawledAt: new Date().toISOString(),
      optionIndex: combo ? optionIndex : undefined,
      optionTotal: optionTotal || undefined,
      optionAxes: raw.optionAxes,
      optionAxisCount: combo ? combo.names.filter(Boolean).length : undefined,
      // 품절: 상품 단위(raw.soldOut) 또는 이 옵션 조합 단위(combo.soldOut)
      soldOut: !!(raw.soldOut || combo?.soldOut),
      categoryPath: raw.categoryPath ?? null, // 분류 근거 추적(감사)
      // 자가복구로 채운 필드(검수 UI가 "확인 필요"로 강조). raw 필드명 → 출력 필드명으로 변환.
      recovered: raw.recovered
        ? Object.entries(raw.recovered).map(([k, v]) => ({
            field: ({ name: 'name', consumerPrice: 'consumer_price' } as Record<string, string>)[k] ?? k,
            confidence: v.confidence,
          }))
        : undefined,
      basis,
    },
  };
}
