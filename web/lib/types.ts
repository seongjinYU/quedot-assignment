// 큐닷 정규화 산출물 타입 — src/normalize/schema.ts 의 최소 미러.
// web/ 격리 유지를 위해 백엔드 코드를 import 하지 않고 필요한 부분만 로컬 선언한다.
// 스키마 변경은 additive(하위호환)라 여기서 깨지지 않는다.

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

export type FillMethod =
  | 'deterministic'
  | 'calculated'
  | 'ai'
  | 'ai-recovery'
  | 'empty'
  | 'crawled';

export interface FieldProvenance {
  method: FillMethod;
  reason?: string; // empty 사유
  source?: string; // ai/calculated/crawled 근거
  fetchedAt?: string; // crawled(외부 실조회) 수집 시각
}

export interface PartnerProductCreateInput {
  brand_name: string | null;
  name: string | null;
  image_url: string | null;
  option1: string | null;
  option2: string | null;
  consumer_price: number | null;
  sales_price: number | null;
  lowest_price: number | null;
  discount_rate: number | null;
  hashtags: string[];
  usp: string | null;
  category_group: CategoryGroup[];
}

export type ProductField = keyof PartnerProductCreateInput;

export interface ProductMeta {
  storeUrl: string;
  productNo: string;
  naverMid?: number | string | null;
  crawledAt: string;
  optionIndex?: number;
  optionTotal?: number;
  optionAxes?: string[];
  optionAxisCount?: number;
  note?: string;
  soldOut?: boolean;
  /** 자가복구(selfHeal)로 복구된 필드 — 검수 UI가 "확인 필요"로 강조 */
  recovered?: { field: string; confidence: number }[];
  /** validate.ts 행별 검증 이슈 — 백엔드가 meta에 저장하면 "검수 권장" 필터가 활성 */
  issues?: {
    field: string;
    level: "error" | "warn";
    type: string;
    message: string;
  }[];
  basis?: {
    categoryPath: boolean;
    detailText: boolean;
    sellerTags: boolean;
    usp: boolean;
  };
  bundle?: {
    quantity: number;
    total: number;
    refProductNo: string | null;
    refUnitListPrice?: number | null;
    basis: string;
  };
}

export interface NormalizedProduct {
  data: PartnerProductCreateInput;
  provenance: Record<ProductField, FieldProvenance>;
  meta: ProductMeta;
}

export interface QualityReport {
  store: string;
  totalProducts: number;
  totalRows: number;
  fillRate: Record<
    string,
    { filled: number; rate: string; method: Record<string, number> }
  >;
  emptyReasons?: Record<string, number>;
  validationIssues?: {
    error: number;
    warn: number;
    byField?: Record<string, number>;
    byType?: Record<string, number>;
  };
  aiUsage?: { enriched: number; ruleFallback: number };
}

export interface StoreIndexEntry {
  slug: string;
  store: string;
  totalProducts: number | null;
  totalRows: number;
  aiUsage: { enriched: number; ruleFallback: number } | null;
  validationIssues: { error: number; warn: number } | null;
  recoveredRows: number;
  crawledAt: string | null;
  sampleImages: string[];
}

export interface StoreIndex {
  stores: StoreIndexEntry[];
  generatedAt: string;
}

/** 검수 테이블 컬럼 정의 (표시 순서) */
export const TABLE_FIELDS: { key: ProductField; label: string }[] = [
  { key: 'option1', label: '옵션1' },
  { key: 'option2', label: '옵션2' },
  { key: 'consumer_price', label: '정가' },
  { key: 'sales_price', label: '판매가' },
  { key: 'lowest_price', label: '최저가' },
  { key: 'discount_rate', label: '할인율' },
  { key: 'category_group', label: '카테고리' },
  { key: 'hashtags', label: '해시태그' },
  { key: 'usp', label: 'USP' },
];

/** 상세 펼침에서만 보이는 필드 (현재 없음 — 전부 컬럼으로 노출) */
export const DETAIL_FIELDS: { key: ProductField; label: string }[] = [];
