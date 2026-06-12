// AI enrichment 추상화 — 룰 baseline / Claude / OpenAI를 같은 인터페이스로 교체
import type { CategoryGroup } from '../normalize/schema.js';

export interface EnrichInput {
  name: string | null;
  categoryPath: string | null; // "식품>건강식품>영양제>오메가3"
  sellerTags: string[];
  detailText: string | null;
  /** 이 스토어가 취급하는 카테고리 텍스트(전 상품에서 모은 distinct 경로). LLM이 "이 사이트가 뭘 파는 곳인지"
   *  파악해 유아/기타·도메인을 판단하는 근거. 키워드 규칙 대신 사이트 실제 카테고리로 분기. */
  siteCategories?: string[];
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
  /** true=LLM 의미배치(3축+, grounded·무손실 가드 통과) / false·미지정=룰(위치) 또는 가드 폴백.
   *  provenance를 실제 처리 경로에 맞춰 정직하게 표기하기 위함. */
  aiPlaced?: boolean;
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
