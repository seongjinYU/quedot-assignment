// 룰 기반 baseline enricher (LLM 미연동 시 동작)
// 철학: 쉬운 분류는 룰로 처리. LLM은 키 연동 시 어려운 케이스만 담당.
import type {
  Enricher,
  EnrichInput,
  EnrichResult,
  OptionNormalizeInput,
  OptionNormalized,
} from './provider.js';
import { CATEGORY_GROUPS, type CategoryGroup } from '../normalize/schema.js';

const BABY_KEYWORDS = /유아|아기|베이비|baby|이유식|영유아|신생아|키즈|kids|어린이/i;

export class RuleEnricher implements Enricher {
  readonly kind = 'rule-baseline';

  async enrich(input: EnrichInput): Promise<EnrichResult> {
    return {
      category_group: this.categoryGroup(input),
      hashtags: this.hashtags(input),
      usp: this.usp(input),
    };
  }

  /** wholeCategoryName + name 키워드로 7종 거칠게 매핑 (정밀화는 LLM 담당) */
  private categoryGroup(input: EnrichInput): CategoryGroup[] {
    const text = `${input.categoryPath ?? ''} ${input.name ?? ''}`;
    const isBaby = BABY_KEYWORDS.test(text);
    const prefix = isBaby ? '유아' : '기타';

    let domain: string;
    if (/식품|건강식품|영양제|간식|분유|이유식|음료|먹거리/.test(text)) domain = '식품';
    else if (/여행|유모차|카시트|외출|캐리어/.test(text)) domain = '여행';
    else domain = '리빙';

    // 유아 건강(영양제 등)은 별도 라벨이 있으므로 우선 처리
    if (isBaby && /건강|영양제|비타민|유산균|오메가/.test(text)) {
      return ['유아 건강'];
    }
    if (isBaby && /놀이|교육|장난감|학습|완구/.test(text)) {
      return ['유아 놀이 교육'];
    }
    const label = `${prefix} ${domain}` as CategoryGroup;
    // 7종 enum 가드 (없으면 가장 가까운 기본값)
    return CATEGORY_GROUPS.includes(label) ? [label] : ['기타 리빙'];
  }

  /** 셀러 태그를 해시태그 baseline으로 (LLM 연동 시 본문 기반 정제) */
  private hashtags(input: EnrichInput): string[] {
    return [...new Set((input.sellerTags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))].slice(0, 8);
  }

  /** USP는 본문 요약이 필요 → 룰로는 미생성(공란). LLM 연동 시 채움 */
  private usp(_input: EnrichInput): string | null {
    return null;
  }

  /**
   * 옵션 정규화 (룰 baseline): 수식어 제거 + 원본 축 순서 유지.
   * ⚠️ 의미론적 재배치(종류↔구성 판단)는 LLM 담당. baseline은 노이즈 제거까지.
   */
  async normalizeOptions(combos: OptionNormalizeInput[]): Promise<OptionNormalized[]> {
    return combos.map((c) => {
      const cleaned = c.names.map((n) => cleanOptionText(n)).filter(Boolean);
      return {
        option1: cleaned[0] ?? null,
        option2: cleaned.length > 1 ? cleaned.slice(1).join(' / ') : null,
        aiPlaced: false, // 위치 기반(결정적)
      };
    });
  }
}

/** 셀러 노이즈 텍스트 제거: [필수]·[선택]·★특가★·(필수)·이모지·중복공백 */
export function cleanOptionText(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, ' ') // [필수], [NEW] 등 대괄호 태그
    .replace(/★[^★]*★/g, ' ') // ★특가★, ★NEW★
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, ' ') // 이모지/기호
    .replace(/^\s*(필수|선택)\s*[:：]?/, ' ') // 머리말 "필수"/"선택"
    .replace(/\s+/g, ' ')
    .replace(/^[\s/·,]+|[\s/·,]+$/g, '') // 앞뒤 구분자
    .trim();
}
