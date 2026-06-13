// 큐닷 상품제안서 스키마 (PartnerProductCreateInput)
// 과제 4️⃣ JSON 예시 기반

/** category_group 7종 고정 라벨 */
export const CATEGORY_GROUPS = [
  '유아 식품',
  '유아 건강',
  '유아 놀이 교육',
  '유아 생활',
  '기타 식품',
  '기타 여행',
  '기타 리빙',
] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export interface PartnerProductCreateInput {
  brand_name: string | null;
  name: string | null;
  image_url: string | null;
  option1: string | null;
  option2: string | null;
  consumer_price: number | null; // 소비자가(정가)
  sales_price: number | null; // 네이버 판매가(즉시할인 적용)
  lowest_price: number | null; // 전체 온라인 최저가 (가산점)
  discount_rate: number | null; // 정가 대비 할인율(%)
  hashtags: string[]; // AI
  usp: string | null; // AI
  category_group: CategoryGroup[]; // AI (7종 enum)
}

/** 필드를 어떻게 채웠는지 추적 (README "필드별 처리 설명" + 못 채운 사유) */
//   ai-recovery: 결정적 추출이 실패(셀렉터/JSON 구조 변경 등)해 원본 payload를 LLM이 재분석·복구한 값.
//   일반 ai(분류·요약)와 구분해 "안전망 복구라 검수 필요"임을 정직하게 표기한다.
export type FillMethod = 'deterministic' | 'calculated' | 'ai' | 'ai-recovery' | 'empty' | 'crawled';

export interface FieldProvenance {
  method: FillMethod;
  /** empty일 때 사유 (지어내지 않고 공란 처리한 이유) */
  reason?: string;
  /** ai/calculated/crawled일 때 근거(원본 소스) */
  source?: string;
  /** crawled(외부 실조회: lowest_price)일 때 수집 시각 — 명세 "출처·수집 시각 함께 기록" */
  fetchedAt?: string;
  /** crawled(lowest_price)일 때 최저가가 나온 쇼핑몰명(옥션·G마켓·판매처 등) — 뷰어·집계용 별도 필드 */
  mall?: string;
}

/** 출력 1건 = 정규화 결과 + 처리 메타 */
export interface NormalizedProduct {
  data: PartnerProductCreateInput;
  provenance: Record<keyof PartnerProductCreateInput, FieldProvenance>;
  /** 원본 추적용 */
  meta: {
    storeUrl: string;
    productNo: string;
    naverMid?: number | string | null; // syncNvMid (lowest_price 매칭 키)
    crawledAt: string; // ISO timestamp
    optionIndex?: number; // 옵션 펼침 시 조합 인덱스
    optionTotal?: number; // 해당 상품의 전체 옵션 조합 수
    optionAxes?: string[]; // 옵션 축 이름
    optionAxisCount?: number; // 이 SKU의 옵션 축 수 (3축 추적 — 큐닷 2칸 제약 사례)
    note?: string; // 옵션 상한 초과 등 비고
    soldOut?: boolean;
    /** 스토어 카테고리 경로(분류 근거 감사용) — 어떤 경로로 7enum이 정해졌는지 추적 */
    categoryPath?: string | null;
    /** 자가복구(selfHeal)로 결정적 추출 실패를 LLM이 복구한 필드 — 검수 UI가 "확인 필요"로 강조 */
    recovered?: { field: string; confidence: number }[];
    /** AI 필드의 실제 근거 유무 (validate가 환각 차단 판단에 사용) */
    basis?: {
      categoryPath: boolean;
      detailText: boolean;
      sellerTags: boolean;
      usp: boolean; // USP 생성 근거 유무 (상세본문 또는 상품명+태그/카테고리)
    };
    /** 묶음(골라담기/N+M) 상품일 때 정규화 근거 (bundle.ts가 채움) */
    bundle?: {
      quantity: number; // 묶음 개수 (5+2 → 7)
      total: number; // 묶음 전체 결제금액 (예: 115010)
      refProductNo: string | null; // 개당 정가 근거가 된 낱개 상품번호 (없으면 매칭 실패)
      refUnitListPrice?: number | null; // 낱개 정가 (개당)
      basis: string; // '단일정가' | '개당통일(매칭실패)'
    };
  };
}
