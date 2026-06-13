// 프로젝트 공통 상수 — 흩어진 매직넘버·불용어를 한곳에 모아 튜닝·문서화를 쉽게 한다(코드리뷰 m1·m5).
//   타이밍·임계값은 "차단 위험/매너"와 직결되므로 함부로 줄이지 말 것(CLAUDE.md 성능 규칙).

/** 크롤 타이밍(ms) — 매너/안정성. 줄이면 차단 위험↑ */
export const TIMING = {
  pageSettle: 1500, // open 후 페이지 안정화 대기
  navSettle: 1000, // goto 후 대기
  godomallRateLimit: 300, // 고도몰 요청 간격(차단 약함)
  enuriPageSettle: 2500, // 에누리 검색결과 렌더 대기
  enuriSortSettle: 1800, // 에누리 정렬 클릭 후 대기
  enuriScrollSettle: 1000, // 에누리 스크롤 후 지연로딩 대기
} as const;

/** 검색/조회 파라미터 */
export const SEARCH = {
  naverDisplay: 40, // 네이버쇼핑 검색결과 수(정확매칭이 상위 10위 밖이어도 회수)
  enuriPoolSize: 4, // 에누리 동시 검색 page 풀 크기
  enuriMaxCards: 12, // 에누리 결과 카드 상한
} as const;

/** lowest_price 매칭 가드 임계값 */
export const PRICE_GUARD = {
  ratioMin: 0.3, // 후보가 우리 판매가(최소)의 0.3배 미만이면 단위 상이 의심 → 제외
  ratioMax: 3, // 후보가 우리 판매가(최대)의 3배 초과면 제외
} as const;

/** 묶음(bundle) 판정 임계값 */
export const BUNDLE = {
  unitMismatchRatio: 1.8, // 판매가/정가 ≥ 1.8 → 단위 섞임(개당가 vs 총액)으로 묶음 의심
} as const;

/** self-heal LLM 입력 payload 최대 길이(토큰 보호) */
export const SELFHEAL_PAYLOAD_MAX = 12000;

/**
 * 도메인 불용어 — 여러 모듈에서 공유(흩어짐 방지, m5).
 *   matchToken: lowest_price 토큰 매칭에서 제외(세트·정품 등 변종/마케팅어)
 *   familyToken: bundle 가족 매칭에서 제외(소비기한·증정 등)
 *   genericCate: 고도몰 카테고리 근거로 부적합한 일반/구조 라벨
 */
export const STOPWORDS = {
  matchToken: new Set(['세트', '정품', '공식', '본사', '무료배송', '사은품', '증정', 'set']),
  familyToken: new Set(['소비기한', 'flavor', 'set', 'the', 'for', '증정', '사은품', 'event']),
  genericCate: new Set(['SHOP', 'ALL', 'BEST', 'NEW', '신상품', '베스트', '전체']),
} as const;
