# 네이버 스마트스토어 정찰 노트 (phytonutri)

> 정찰 일시: 2026-06-10 / 대상: smartstore.naver.com/phytonutri
> 목적: 결정적 추출을 위한 내부 JSON 엔드포인트 + 필드 매핑 확정

---

## 1. 차단 돌파 과정 (회고 소스)

| 시도 | 결과 | 교훈 |
|---|---|---|
| `curl` + 헤더 보강 | **429** → `[에러]시스템오류` | 단순 HTTP는 TLS지문·IP평판으로 즉시 차단 |
| Playwright (기본) | 캡차 스크립트 로드(`ncaptcha-api.js`) | 자동화 흔적(`navigator.webdriver`) 감지 |
| Playwright + stealth | **로그인 강제 리다이렉트** | 반복 접근으로 IP 평판 하락 → 로그인 벽 |
| **persistent 세션 + 사용자 1회 로그인** | **HTTP 200, 캡차 없음, JSON 캡처 ✓** | 인증 세션 재사용이 정공법 |

→ 결론: 네이버는 **실브라우저 엔진 + 인증 세션**이 있어야 안정적 접근. 데이터는 화면 파싱이 아니라 **내부 JSON 가로채기**로 결정적 추출.

---

## 2. 식별자

- channelUid: `2sWDwjwkda8ZTlTJc9CcP`
- channelNo: `100128005`
- accountNo: `100115519`

---

## 3. 핵심 엔드포인트

| 용도 | 엔드포인트 | 비고 |
|---|---|---|
| **상품 상세(결정적)** | `GET /i/v2/channels/{uid}/products/{productNo}?withWindow=false` | 이름·정가·옵션·이미지·카테고리·태그 전부 |
| **가격/할인/배송비** | `POST /i/v2/channels/{uid}/product-benefits` (body: `{products:[{id,channelNo}]}`) | 즉시할인·실결제가·배송비 |
| 단일상품 혜택 | `POST /i/v2/channels/{uid}/product-benefits/{productNo}` | 상세용 |
| 상세 콘텐츠(HTML) | `GET /i/v2/channels/{uid}/products/{productNo}/contents/{contentNo}` | USP 추출 소스 |
| **목록(페이지네이션)** | `GET /i/v2/channels/{uid}/categories/ALL/products?categorySearchType=DISPCATG&sortType=POPULAR&page={N}&pageSize=40&deduplicateGroupEpId=true` | ⚠️ 직접 fetch는 429(앱 서명헤더 요구) → **페이지 버튼 클릭 후 응답 가로채기**가 안정적. 1페이지(40개)는 SSR `__PRELOADED_STATE__.categoryProducts`로 확보 |
| 찜/인기도 | `GET /i/v1/keeps/products/{id,id,...}` | 상품 ID 리스트 확보에도 활용 |
| 메인 위젯 상품 | `__PRELOADED_STATE__.widgetContents...simpleProducts[]` | 초기 상품 목록(SSR) |

- 진입점: 페이지 HTML의 `window.__PRELOADED_STATE__` (SSR JSON) → `product` 키에 상세 전체.

---

## 4. 필드 매핑 (큐닷 PartnerProductCreateInput)

| 큐닷 필드 | 출처 | 처리 |
|---|---|---|
| brand_name | `naverShoppingSearchInfo.brandName` / `channel.channelName` | 결정적 |
| name | `name` | 결정적 |
| image_url | `productImages[].url` (imageType=REPRESENTATIVE) | 결정적 |
| option1/option2 | `optionCombinations[]` / `options[]` | 옵션 텍스트 정규화(AI 보조) |
| consumer_price | `salePrice` (정가/소비자가) | 결정적 |
| sales_price | product-benefits `totalPayAmount` (즉시할인 적용가) | 결정적 |
| discount_rate | (consumer-sales)/consumer ×100 | 계산 |
| **배송비(실결제 보조)** | product-benefits `baseFee`, `freeConditionalAmount` | 계산 |
| hashtags | `seoInfo.sellerTags[]` + name | **AI** 추출/정제 |
| usp | 상세 contents HTML | **AI** 요약 |
| category_group | `category.wholeCategoryName` (예: 식품>건강식품>영양제>오메가3) | **AI** → 7종 enum 매핑 |
| lowest_price | `epInfo.syncNvMid`(네이버쇼핑 매칭 ID) 활용 | **가산점** (동일상품 매칭 키 확보됨) |

※ 핵심 수확: `syncNvMid`(네이버쇼핑 mid)가 상세에 들어있어, lowest_price 가산점의 **동일 상품 매칭**을 ID 기반으로 풀 여지가 생김(이름 매칭보다 정확).

---

## 5. 남은 정찰 (구현 중 확정)

- [x] 전체상품 **목록 페이지네이션 엔드포인트** 확정 (page 버튼 클릭 + 가로채기)
- [ ] `optionCombinations` 3축/품절/추가금 구조 상세 (옵션 정규화 엣지케이스)
- [ ] brand.naver.com(kefii) 동일 구조 여부 확인 (스마트스토어와 같은 `i/v2/channels` 패턴 추정)
- [ ] happyland 공식몰 별도 어댑터

## 7. 핵심 메커니즘 결론

- **접근**: persistent 인증 세션 필수 (curl/직접fetch 429, SSR 네비게이션 200)
- **상세/단일조회**: 세션 컨텍스트에서 `apiGet` 직접 호출 OK (`products/{id}?withWindow=false`)
- **목록 페이지네이션**: 직접 fetch는 서명헤더 부재로 429 → **페이지 버튼 클릭 → XHR 가로채기**로 결정적 수집
- **상품번호 주의**: `id`=channelProductNo(상세 URL용), `productNo`=originProductNo(별개). 상세 호출엔 `id` 사용

---

## 6. 산출물 파일 (정찰)

- `recon-login.js` — persistent 세션 + 목록 JSON 캡처
- `recon2.js` — __PRELOADED_STATE__ 덤프 + 상세 API 캡처
- `recon_result.json` / `preloaded_main.json` / `preloaded_detail.json` / `detail_json.json`
- `naver-session/` — 인증 세션(.gitignore 필요, 커밋 금지)
