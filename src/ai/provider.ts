// AI enrichment 추상화 — 룰 baseline / Claude / OpenAI를 같은 인터페이스로 교체
import type { CategoryGroup } from '../normalize/schema.js';

export interface EnrichInput {
  name: string | null;
  categoryPath: string | null; // "식품>건강식품>영양제>오메가3"
  sellerTags: string[];
  detailText: string | null;
}

export interface EnrichResult {
  category_group: CategoryGroup[];
  hashtags: string[];
  usp: string | null;
}

/** 옵션 정규화 입출력 — LLM은 표시 텍스트만 다룸(가격·식별은 호출부가 원본 유지) */
export interface OptionNormalizeInput {
  names: string[]; // 원본 축 값들 [optionName1, 2, 3]
}
export interface OptionNormalized {
  option1: string | null; // 종류/맛/색상
  option2: string | null; // 구성/수량/용량
}

export interface Enricher {
  readonly kind: string; // 'rule-baseline' | 'claude' | 'openai'
  enrich(input: EnrichInput): Promise<EnrichResult>;
  /**
   * 옵션 조합 텍스트를 의미론적으로 정규화 (배치).
   * 입력 순서 = 출력 순서 보장. LLM은 표시 텍스트만 생성하고 가격/식별엔 관여하지 않는다.
   */
  normalizeOptions(combos: OptionNormalizeInput[], ctx: { productName: string | null }): Promise<OptionNormalized[]>;
}
