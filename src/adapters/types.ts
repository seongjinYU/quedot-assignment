// 스토어 어댑터 인터페이스 — "다른 링크 넣어도 작동" + 확장성
// 각 몰의 원본 구조를 공통 RawProduct로 정규화하기 직전까지 책임진다.

/** 옵션 조합 1개 (펼침 단위) */
export interface OptionCombo {
  names: string[]; // [축1값, 축2값, 축3값] — 네이버 optionName1/2/3
  addPrice: number; // 기본가 대비 추가금
  stock?: number;
  soldOut?: boolean;
}

/** 어댑터가 추출한 원본(정규화 전 공통 형태) */
export interface RawProduct {
  productNo: string;
  brandName?: string | null;
  name: string | null; // 어댑터가 못 얻으면 null (mapper에서 provenance empty 처리)
  representativeImage?: string | null;
  images?: string[];
  consumerPrice?: number | null; // 정가(소비자가)
  salePrice?: number | null; // 즉시할인 적용가 (없으면 null)
  deliveryFee?: { base?: number; freeOver?: number; type?: string } | null;
  optionAxes?: string[]; // 옵션 축 이름 (groupName)
  optionCombos?: OptionCombo[]; // 옵션 조합 (펼침 대상)
  categoryPath?: string | null; // "식품>건강식품>영양제>오메가3"
  sellerTags?: string[];
  detailText?: string | null; // USP 소스 (상세 설명 텍스트)
  detailTextSource?: 'inline' | 'ocr'; // detailText 출처 (provenance 정직성)
  detailImages?: string[]; // 상세 설명 이미지 URL (텍스트 없을 때 OCR 대상)
  naverMid?: number | string | null; // 네이버쇼핑 매칭 ID (lowest_price용)
  sourceUrl: string;
}

export interface ListOptions {
  limit?: number; // 수집 상품 수 제한 (개발/테스트용)
}

/** 가격 정보 (배치 조회 결과) */
export interface PriceInfo {
  consumerPrice?: number | null; // 정가(소비자가)
  salePrice?: number | null; // 즉시할인 적용 판매가
  deliveryFee?: { base?: number; freeOver?: number; type?: string } | null;
}

export interface StoreAdapter {
  readonly name: string;
  /** 브라우저 세션이 필요한지 (false면 순수 HTTP fetch — 브라우저 안 띄움) */
  readonly needsBrowser?: boolean;
  /** 이 어댑터가 처리할 URL인지 (도메인 기반 자동 선택) */
  matches(url: string): boolean;
  /** 스토어의 전 상품 번호 순회 수집 */
  listProductNos(storeUrl: string, opts?: ListOptions): Promise<string[]>;
  /** 단일 상품 결정적 추출 */
  fetchProduct(storeUrl: string, productNo: string): Promise<RawProduct>;
  /** (선택) 가격 배치 조회 — 여러 상품을 한 번에 (개별 호출 회피) */
  fetchPrices?(storeUrl: string, ids: string[]): Promise<Map<string, PriceInfo>>;
}
