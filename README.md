# 큐닷 AX 과제 — 브랜드 스토어 → 큐닷 상품제안서 자동 정규화

브랜드 스토어 URL 하나를 넣으면 **전 상품을 크롤링 → AI로 분석·구조화 → 큐닷 상품제안서(JSON)** 로 자동 정규화합니다.
네이버 스마트스토어/브랜드스토어와 비(非)네이버 공식몰(고도몰)을 지원하며, **다른 링크를 넣어도 동작**하도록 어댑터 패턴으로 설계했습니다.

> 이 과제의 목표는 "많이·빠르게 긁기"가 아니라 **"바로 쓸 수 있는, 근거가 검증된 데이터"** 입니다.
> AI는 비싸고 틀릴 수 있는 부품으로 다루고(룰 우선·검증·fallback), 못 채운 값은 지어내지 않고 사유와 함께 비웠습니다.

---

## 1. 핵심 설계 원칙 (타협하지 않은 것)

| 원칙 | 의미 |
|---|---|
| **결정적 추출** | 화면 셀렉터 파싱이 아니라 **내부 JSON API / 구조화 데이터**에서 추출. 셀렉터는 최후 수단. |
| **룰 우선, LLM은 어려운 20%만** | 가격·이미지·이름은 코드로 결정적 처리. 비정형 분류·요약(category/hashtags/usp/옵션 의미배치)만 LLM. |
| **AI 출력을 신뢰하지 않는다** | 모든 LLM 출력은 `validate.ts` 단일 관문의 스키마·범위 가드를 통과해야 한다. |
| **지어내지 않는다** | 크롤·AI로 못 얻는 값은 **공란(null) + 사유(provenance)**. 추측으로 채우지 않는다. |
| **크롤링 매너/합법성** | 요청 딜레이 유지, 과도한 요청 금지, 인증은 **사용자 본인 세션 재사용**. |

---

## 2. 아키텍처

```
URL → [crawler] 통신 → [adapters] 스토어별 수집 → [normalize] 매핑·검증 → [ai] 분류·요약 → JSON
                                  단방향 의존 (crawler → adapters → normalize → ai)
```

- **어댑터 패턴**: 스토어별 수집기는 `StoreAdapter` 인터페이스 구현. **새 몰 = 어댑터 1개 추가.**
- **AI는 인터페이스(`Enricher`)로 추상화** → 룰/OpenAI 교체 가능, 키 없으면 룰 baseline으로 자동 강등.
- **환각 차단 단일 관문(`validate.ts`)**: provider(openai/rule/fallback) 경로 무관하게 최종 산출물은 반드시 통과.
- **상품 단위 에러 격리**: 한 상품이 실패해도 로그 남기고 다음 상품 계속.

> 📊 전체 크롤링→저장 흐름 시각화: **`docs/crawl-flow.html`** (브라우저로 열면 단계별 다이어그램 + 실제 샘플)

### 지원 스토어

| 스토어 | 어댑터 | 방식 |
|---|---|---|
| 네이버 스마트스토어 | `NaverStoreAdapter` | 인증 브라우저 세션 + 내부 JSON API(`/i/v2/...`) |
| 네이버 브랜드스토어 | `NaverStoreAdapter` (재사용) | 동일 (prefix `/n/` 차이만) |
| 고도몰 기반 공식몰 | `GodomallAdapter` | 순수 HTTP fetch + cheerio (브라우저 불필요) |
| 그 외 (미지원 플랫폼) | — | 런타임 검증 후 **명확한 에러로 graceful 실패** |

`GodomallAdapter`는 특정 도메인이 아니라 **고도몰 플랫폼 자체**(godomall/NHN커머스 마커)를 감지하므로, happyland 외 다른 고도몰 쇼핑몰도 자동으로 동작합니다.

---

## 3. 실행 방법

### 설치
```bash
npm install
npx playwright install chromium   # 네이버 크롤링용 (고도몰만 쓰면 불필요)
cp .env.example .env              # OPENAI_API_KEY (없으면 룰 baseline) / NAVER 키(가산점·선택)
```

### 크롤링
```bash
# 사용법: npm run crawl <스토어URL> <상품수limit> [ocr] [enuri]
npm run crawl "https://smartstore.naver.com/phytonutri" 0          # 0 = 전수
npm run crawl "https://brand.naver.com/kefii" 10
npm run crawl "https://m.happylandmall.com/" 20
npm run crawl "https://m.happylandmall.com/" 20 ocr                # OCR 보강 ON (아래 6번)
npm run crawl "https://brand.naver.com/kefii" 10 enuri             # 최저가 실조회 ON (아래 6번·가산점)
```

- **네이버**: 최초 1회 브라우저 창에서 **직접 로그인** → 이후 persistent 세션 재사용(캡차 없음).
- 결과: `output/{스토어명}.json` (정규화 데이터) + `output/{스토어명}.quality.json` (정제 품질 리포트).

---

## 4. 출력 형식

출력은 **옵션 조합 1개 = SKU 1행**으로 펼쳐진 `NormalizedProduct[]` 입니다. 한 상품에 옵션이 8개면 8행이 나옵니다.

```jsonc
{
  "data": {                          // ← 큐닷 상품제안서 필드
    "brand_name": "케피",
    "name": "케피 버블클렌저 3개 핑크+옐로우+퍼플 ...",
    "image_url": "https://...rep.jpg",
    "option1": "버블클렌저",          // 색상/종류
    "option2": "핑크+옐로우+퍼플",     // 구성/수량/사이즈
    "consumer_price": 32700,          // 정가
    "sales_price": 18300,             // 즉시할인 적용가
    "discount_rate": 44,
    "lowest_price": 18300,            // 시장 전체 실조회 최저가 (이 상품은 정품 동일listing이 최저=판매가와 동일)
    "hashtags": ["버블클렌저", "유아바디워시", ...],
    "usp": "아기와 함께 즐길 수 있는 다양한 색상의 거품 목욕 제품입니다.",
    "category_group": ["유아 생활"]   // 큐닷 7종 enum
  },
  "provenance": {                     // ← 각 값을 "어떻게 얻었는지" (정직성)
    "name": { "method": "deterministic" },
    "usp":  { "method": "ai", "source": "상세이미지OCR / openai" },
    "lowest_price": { "method": "crawled", "source": "네이버쇼핑+에누리 실조회 · pid==mid 정확매칭(정품 동일listing=판매가)", "fetchedAt": "2026-06-12T..." }
  },
  "meta": {                           // ← 추적·검수용 (출처·옵션 인덱스·근거 유무)
    "productNo": "4971375678", "naverMid": 82515896000,
    "optionIndex": 0, "optionTotal": 12,
    "basis": { "categoryPath": true, "detailText": false, "sellerTags": true, "usp": true }
  }
}
```

---

## 5. 필드별 처리 방식

| 필드 | 처리 | 출처 |
|---|---|---|
| `brand_name` | **결정적** | 네이버 `naverShoppingSearchInfo.brandName` / 고도몰 상품명 `[브랜드]` |
| `name` | **결정적** | 상세 API `name` / 목록 카드 `data-goods-nm` |
| `image_url` | **결정적** | 대표 이미지(REPRESENTATIVE) 1장 (전체는 내부 `images[]`에 보유) |
| `consumer_price` | **결정적/계산** | 정가 + 옵션 추가금 |
| `sales_price` | **결정적/계산** | 네이버 `product-benefits` 배치 즉시할인가 / 고도몰 정가판매 |
| `discount_rate` | **계산** | (정가−판매가)/정가 ×100 |
| `option1` / `option2` | **결정적 or AI** | 단일 축은 룰(결정적), 다축만 LLM 의미배치(종류↔구성) |
| `hashtags` | **AI** | 셀러태그 + 상품명 (없으면 상세이미지 OCR + 상품명) |
| `usp` | **AI** | 상품명·태그·카테고리·상세설명에서 **확인된 사실만** (근거 없으면 공란) |
| `category_group` | **AI** | 카테고리 경로 + 상품명 → 7종 enum 매핑 |
| `lowest_price` | **실조회(가산점)** | 네이버쇼핑 OpenAPI + 에누리(쿠팡 포함) 시장 최저가 · mid/모델코드/LLM **3층 매칭**(오탐 시 `null`) |

> 모든 필드는 `provenance`에 `method`(deterministic/calculated/ai/empty)와 근거/사유가 기록됩니다.
> `method`가 실제 처리 경로와 일치하도록 정직하게 표기합니다(예: 단일 축 옵션은 `ai`가 아니라 `deterministic`).

---

## 6. AI 활용 & 조건부 OCR (차별화)

### 룰 우선 + 환각 차단
- 정형 데이터는 코드로, **LLM은 category/hashtags/usp/옵션 의미배치만** 담당.
- OpenAI **structured output(json_schema)** 으로 출력 강제, category는 **7종 enum**으로 제약.
- LLM 실패·개수 불일치 시 **룰 baseline fallback** → 키가 없어도 동작.
- 모든 출력은 `validate.ts` 단일 관문 통과: 7종 밖 카테고리 제거, 근거 없는 USP 무효화, 음수 가격 차단 등.

### 조건부 OCR (근거 부족 상품 보강)
고도몰 상세는 본문이 **이미지**라 텍스트 근거가 없습니다(USP/hashtags가 빈약). 이를 보강:

- **트리거**: `셀러태그 없음 AND 본문텍스트 없음`(근거 부족)일 때만 → 네이버(셀러태그 보유)는 **스킵**(비용 0).
- 상세 설명 이미지(`_DC` composite)를 **세로 스트립으로 분할 → gpt-4o-mini 비전 OCR → 결합**.
  - ⚠️ 통짜 OCR은 다운스케일로 환각(유아 사이즈 `80/90/100/110` → `S/M/L`)이 생김 → **스트립 분할 + 리사이즈**로 정확도 확보.
  - 토큰(TPM) 보호: 동시성 제한 + 512px 리사이즈 + 429 백오프 재시도.
- 결과 detailText로 USP/hashtags를 **실제 소재·특징 기반**으로 생성하고, provenance에 `상세이미지OCR`로 정직 표기.

```bash
# OCR은 opt-in (평소엔 OFF → 빠름)
npm run crawl "https://m.happylandmall.com/" 20 ocr
```

### lowest_price 실조회 (가산점) — 오탐 방지 우선
"시장 최저가"는 **틀린 값을 채우느니 `null`** 이라는 원칙으로 구현. 동일 상품 식별이 핵심이라 **3층 매칭**:

- **2개 소스 병합**: ① 네이버쇼핑 OpenAPI(`syncNvMid` 정확매칭·빠름, 단 쿠팡 미포함) + ② 에누리 가격비교(쿠팡·11번가·G마켓 등 오픈마켓 포함, 브라우저 렌더). 둘 중 **더 낮은 값**.
- **3층 매칭(오탐 차단)**: `pid==mid` 정확일치 또는 **모델코드 일치**는 결정적 확정(LLM 생략) → 나머지 휴리스틱 후보(브랜드+토큰+수량/용량+묶음 단위 통과)만 **LLM이 동일상품 최종 검수**. 통과 후보 없으면 `null`.
- **단위 오탐 가드**: 가격 sanity(0.3~3배), `6종≠7종`·`3개≠11개`·`1+1(2개)≠단품` 등 수량/묶음 불일치 차단. mid가 같아도 세트 vs 개당이면 제외.
- **판매가가 시장 최저면** 그 값을 최저가로 채우고 **타몰 최저도 함께 기록**(투명). `provenance`에 채움 경로(`pid==mid`/`모델코드확정`/`LLM확인`)를 정직 표기.

```bash
# 가산점: 시장 최저가 실조회
#   네이버쇼핑은 .env의 NAVER_CLIENT_ID/SECRET만 있으면 자동 조회
#   에누리(쿠팡 포함)는 인자 enuri로 opt-in (OPENAI_API_KEY 있어야 비-mid 후보 LLM 검수)
npm run crawl "<store-url>" 20 enuri
```

---

## 7. 정제 품질 & 엣지케이스

자세한 수치·사례는 **`EDGE_CASES.md`** 참조. 요약:

- **필드별 채움률 수치화** + 실패 건수 + AI fallback 횟수 (`output/*.quality.json` 자동 생성).
- 옵션 엣지케이스: 추가금 반영, 노이즈(`★특가★`·이모지·`[필수]`) 제거, 1~3축/SIMPLE형/단일상품/품절.
- 구조적 한계: 큐닷 `option1/2` 2칸 vs 소스 최대 3축 → 3축은 `option2`에 결합(소수).
- 검증 관문이 잡아낸 것: USP 환각 차단, enum 밖 분류 제거, 근거 없는 다중분류 축소, 가격 이상 무효화.

---

## 8. 회고 (고민·트레이드오프·해결 못한 것)

전문은 **`REFLECTION.md`**. 핵심만:

1. **봇 차단 — "뚫는 기술"보다 "리스크를 의식한 정공법".**
   curl/직접 fetch는 429, Playwright 기본도 캡차/로그인 벽. 프록시·캡차솔버 대신 **사용자 1회 로그인 세션을 persistent로 재사용**(합법·안정).
2. **결정적 추출 — 화면 파싱 대신 내부 JSON API.**
   네이버는 `/i/v2/...` 내부 API, 고도몰은 카드 `data-*` 속성. 구조 변경 취약성을 줄이고 정형 데이터 확보.
3. **어댑터 패턴 — "다른 링크도 작동" 요구 충족.**
   네이버 2종은 prefix 차이만으로 하나의 어댑터. 고도몰은 도메인이 아닌 **플랫폼**을 감지해 일반화.
4. **성능 — 목록 우선 + 가격 배치 + 호출 최소화.** 딜레이는 줄이지 않고 "호출 횟수 감소"로 속도 확보.
5. **AI — 룰 우선·검증·fallback.** 초기엔 환각 가드가 흩어져 거짓 provenance("categoryPath 기반"인데 실제 null)를 표기한 실수 → **validate 단일 관문 + `basis` 정직 기록**으로 수정.
6. **★ "상세 본문 텍스트 추출"의 환상 — 그리고 OCR을 향한 세 번의 반전.**
   - 네이버 상세는 거의 이미지, 별도 contents API로 긁어도 SEO 키워드뿐 → "본문 추출 성공"이라 **과장 표기했다가 실데이터 검증 후 정정**.
   - happyland OCR도 "텍스트 없는 상품 사진"이라 **"도입 안 함"으로 단정했는데, 사실 엉뚱한 이미지를 본 것**이었음. 실제 상세 composite(`_DC.jpg`)엔 소재·사이즈·설명이 가득.
   - → 같은 실수(일부만 보고 과일반화)를 **세 번** 반복하고 매번 실데이터로 정정. **"검증했다는 말 자체도 검증 대상"** 이라는 메타 교훈.
   - 최종적으로 OCR을 **조건부·스트립분할·정직 provenance**로 구현.

**해결 못한 것 / 더 시간이 있었다면**: 쿠팡 **직접** 조회(현재는 Akamai·파트너스 키 요건으로 **에누리 경유**), 3축 옵션의 완전한 표현, OCR 속도 최적화(멀티이미지 단일호출), 증분 재크롤.

---

## 9. 보안 (제출 시 반드시 확인)

`.gitignore`에 등록되어 **커밋되지 않음** — 제출 repo에 개인정보가 들어가지 않게 확인:
- `naver-session/` (로그인 쿠키), `.env` (API 키), `*.log`, 개인 전략 문서

---

## 10. 프로젝트 구조

```
src/
├─ main.ts                  # 파이프라인 엔트리 (URL → 크롤 → 정규화 → AI → 검증 → 출력)
├─ crawler/browser.ts       # persistent 인증 세션 + 내부 API 호출
├─ adapters/
│  ├─ types.ts              # StoreAdapter 인터페이스 / RawProduct
│  ├─ naver.ts              # 네이버 스마트스토어·브랜드스토어
│  └─ godomall.ts           # 고도몰 범용 (happyland 등)
├─ normalize/
│  ├─ mapper.ts             # RawProduct → 큐닷 필드 + provenance
│  ├─ validate.ts           # 환각 차단 단일 관문
│  ├─ schema.ts             # 큐닷 스키마 / 7종 카테고리 enum
│  └─ quality.ts            # 정제 품질 리포트
└─ ai/
   ├─ provider.ts           # Enricher 인터페이스
   ├─ rule.ts               # 룰 baseline (LLM 미연동 시)
   ├─ openai.ts             # OpenAI structured output
   └─ ocr.ts                # 조건부 상세이미지 OCR (sharp + 비전)

docs/crawl-flow.html        # 크롤링→저장 흐름 시각화 (+ 실제 샘플)
RECON_NOTES.md              # 정찰 기록 (엔드포인트·필드 매핑)
EDGE_CASES.md               # 엣지케이스 카탈로그 + 품질 수치
REFLECTION.md               # 회고 원천 자료
```

## 기술 스택
TypeScript(tsx) · Playwright + playwright-extra(stealth) · cheerio · OpenAI gpt-4o-mini(structured output + vision) · sharp
