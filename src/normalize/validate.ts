// 출력 검증 — 모든 환각/이상치 차단의 단일 관문(single gate).
// 원칙(CLAUDE.md 3·4): AI 출력 불신 + 근거 없으면 공란.
// AI provider(rule/openai)나 fallback 경로와 무관하게, 최종 산출물은 반드시 이 관문을 통과한다.
// 무효화 시 데이터뿐 아니라 provenance도 정직하게(empty+사유) 갱신해 신뢰성 유지.
import { CATEGORY_GROUPS, type NormalizedProduct } from './schema.js';

/** 검증 이슈 유형 — 품질 리포트의 "실패 유형 분류"에 사용 */
export type IssueType =
  | 'usp_hallucination' // USP 근거 없음 → 무효화
  | 'category_enum' // 7종 외 라벨 제거
  | 'category_lowconf' // 근거 없는 다중분류 축소
  | 'option_cleanup' // 옵션 텍스트 정리(null/빈값)
  | 'price_invalid' // 비정상 가격(음수/NaN) 무효화
  | 'price_inverted' // 판매가 > 정가
  | 'discount_range' // 할인율 범위 밖 무효화
  | 'discount_uncomputable' // 정가/판매가 미확보로 할인율 계산 불가
  | 'hashtag_cleanup' // 비정상/중복 태그 정리
  | 'missing_name' // 상품명 누락
  | 'missing_image'; // 대표 이미지 누락

export interface ValidationIssue {
  field: string;
  level: 'error' | 'warn';
  type: IssueType;
  message: string;
}

export function validate(np: NormalizedProduct): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const d = np.data;
  const prov = np.provenance;
  const basis = np.meta.basis ?? { categoryPath: false, detailText: false, sellerTags: false, usp: false };
  const add = (field: string, level: 'error' | 'warn', type: IssueType, message: string) =>
    issues.push({ field, level, type, message });

  // ── AI 환각 차단 (근거 기반) ──────────────────────────────

  // 1) USP: 근거(상세본문 또는 상품명+태그/카테고리) 없으면 무효화 (근거 없는 문장 생성 금지)
  if (d.usp != null && !basis.usp) {
    add('usp', 'error', 'usp_hallucination', 'USP 무효화: 생성 근거 없음 → 환각 차단');
    d.usp = null;
    prov.usp = { method: 'empty', reason: '상품명·태그·카테고리·상세본문 근거 모두 없음(환각 방지)' };
  }

  // 2) category_group: 7종 enum 밖 제거
  const invalidCats = d.category_group.filter((c) => !CATEGORY_GROUPS.includes(c));
  if (invalidCats.length) {
    add('category_group', 'error', 'category_enum', `7종 외 라벨 제거: ${invalidCats.join(', ')}`);
    d.category_group = d.category_group.filter((c) => CATEGORY_GROUPS.includes(c));
  }
  // 2-b) categoryPath 근거 없이 과다 선택(상품명만으로 2개 초과)은 신뢰 불가 → 1개로 축소 경고
  if (!basis.categoryPath && d.category_group.length > 1) {
    add('category_group', 'warn', 'category_lowconf', `근거(categoryPath) 없이 다중 분류 → 상위 1개만 유지(저신뢰)`);
    d.category_group = d.category_group.slice(0, 1);
    if (prov.category_group.method === 'ai') {
      prov.category_group = { method: 'ai', source: `${prov.category_group.source} · 저신뢰(근거없음)` };
    }
  }
  if (d.category_group.length === 0 && prov.category_group.method === 'ai') {
    prov.category_group = { method: 'empty', reason: '유효 카테고리 없음' };
  }

  // 3) 옵션 텍스트: "null"/"undefined" 문자열·빈값 정리 (provider 경로 무관 최종 정리)
  for (const k of ['option1', 'option2'] as const) {
    const v = d[k];
    if (typeof v === 'string') {
      const cleaned = v
        .replace(/\b(null|undefined)\b/gi, '')
        .replace(/\s*\/\s*/g, ' / ')
        .replace(/^[\s/]+|[\s/]+$/g, '')
        .trim();
      if (cleaned !== v) {
        add(k, 'warn', 'option_cleanup', `옵션 텍스트 정리: "${v}" → "${cleaned || '(빈값)'}"`);
        d[k] = cleaned.length ? cleaned : null;
        if (!d[k]) prov[k] = { method: 'empty', reason: '옵션 텍스트 정리 후 빈값' };
      }
    }
  }

  // ── 가격/수치 가드 ────────────────────────────────────────
  for (const k of ['consumer_price', 'sales_price', 'lowest_price'] as const) {
    const v = d[k];
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      add(k, 'error', 'price_invalid', `비정상 가격 무효화: ${v}`);
      d[k] = null;
      prov[k] = { method: 'empty', reason: `비정상 가격(${v}) 무효화` };
    }
  }
  if (d.consumer_price != null && d.sales_price != null && d.sales_price > d.consumer_price) {
    add('sales_price', 'warn', 'price_inverted', `판매가(${d.sales_price}) > 정가(${d.consumer_price})`);
  }
  // 할인율 범위 가드 (무효화 메시지는 무효화 전 값으로)
  if (d.discount_rate != null && (d.discount_rate < 0 || d.discount_rate > 100)) {
    add('discount_rate', 'error', 'discount_range', `할인율 범위 밖 무효화: ${d.discount_rate}`);
    prov.discount_rate = { method: 'empty', reason: `할인율 범위 밖(${d.discount_rate}) 무효화` };
    d.discount_rate = null;
  }
  // 가격이 무효화돼 계산 불가가 된 discount_rate 정리 (null인데 calculated로 남는 모순 방지)
  if (d.discount_rate == null && prov.discount_rate?.method === 'calculated') {
    add('discount_rate', 'warn', 'discount_uncomputable', '정가/판매가 미확보로 할인율 계산 불가');
    prov.discount_rate = { method: 'empty', reason: '정가/판매가 미확보로 할인율 계산 불가' };
  }

  // ── 해시태그 정리 ─────────────────────────────────────────
  const cleanTags = [...new Set(d.hashtags.filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 30))];
  if (cleanTags.length !== d.hashtags.length) {
    add('hashtags', 'warn', 'hashtag_cleanup', '비정상/중복 태그 정리');
    d.hashtags = cleanTags;
  }

  // ── 필수 식별 필드 ────────────────────────────────────────
  if (!d.name) add('name', 'error', 'missing_name', '상품명 누락');
  if (!d.image_url) add('image_url', 'warn', 'missing_image', '대표 이미지 누락');

  return issues;
}
