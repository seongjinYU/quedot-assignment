# PROGRESS.md — 진행 상황

> 작업 시작 전 이 파일로 현재 상태 확인. 작업 완료 시 체크 갱신.
> 규칙은 CLAUDE.md, 정찰 정보는 RECON_NOTES.md 참조.

마지막 업데이트: 2026-06-12

---

## ✅ 완료

- [x] 차단 메커니즘 분석 (curl 429 → 실브라우저 → 캡차 → persistent 세션 돌파)
- [x] 네이버 내부 API 정찰 (상세/가격/목록 엔드포인트 + 필드 매핑 확정)
- [x] 프로젝트 셋업 (TypeScript + Playwright + stealth)
- [x] 코드 뼈대: 어댑터 인터페이스 / 큐닷 스키마 / mapper / validate / main
- [x] BrowserSession (persistent 세션 + 내부 API 직접 호출)
- [x] 네이버 어댑터 (상세 결정적 추출)
- [x] 룰 baseline enricher (category/hashtags)
- [x] **1상품 end-to-end 관통 성공** (output/phytonutri.json)

## 🔧 진행 중 / 다음

### A. 네이버 어댑터 완성 (필수)
- [x] **1. 가격 배치 연동** — sales_price, discount_rate, 배송비 (product-benefits 배치) ✅ 3건 검증
- [x] **2. 옵션 정규화** — 조합 펼침(상한 없음, 전수) + 추가금 가격 반영 ✅
  - 수식어 제거 baseline(★특가★·[필수]·이모지) + 가격은 원본 유지(환각 가드)
  - normalizeOptions 인터페이스로 LLM 끼울 자리 마련 → 의미론적 재배치(종류↔구성)는 6번에서
- [x] **2b. 산출물 단위 = 옵션 조합(SKU)** ✅ (큐닷 예시 스키마 정합)
  - 큐닷 예시의 option1/2가 단일값 + 가격 1:1 → SKU 단위 설계. **옵션마다 가격·품절이 달라**
    (예: 케피 선물패키지 23,800/26,800원) SKU별로 펼쳐 가격 정확도 보존 — 대표 1행으로 줄이면 손실
  - '상품 수'(productNo)와 'SKU 수'는 품질 리포트에 병기(totalProducts/totalRows · 콘솔 "원상품 N개 → SKU M건")
  - kefii 상품 50 / SKU 384, phytonutri 상품 59 / SKU 103
- [x] **3. 전수 페이지네이션** — 40 + 19 = 59개 전수 ✅ (page 버튼 클릭 + XHR 가로채기)

### B. 다른 스토어 어댑터 (필수)
- [x] **4. kefii 브랜드스토어** ✅ 네이버 어댑터 재사용 (smartstore=/i/, brand=/n/ prefix 차이만) — 2축 옵션 검증
- [x] **5. happyland 공식몰** ✅ 고도몰/순수 HTTP fetch (브라우저 불필요)
  - 목록 fetch(data 속성) + 옵션 layer_option.php POST(쿠키+AJAX헤더, 색상:사이즈 분리)
  - 정가판매(할인 표시 없음) / 5상품 6.8초 — 브라우저 대비 대폭 단축
- [x] **(일반화) 고도몰 범용 어댑터** ✅ HappylandAdapter→GodomallAdapter. 도메인 하드코딩(happylandmall) 제거 → 비네이버 몰을 후보로 받고 런타임 고도몰 마커 검증(godomall/nhncommerce/goods_view.php/layer_option.php/data-goods-no). 비고도몰은 명확한 에러로 graceful 실패. "다른 링크도 작동" 충족 (다른 고도몰 자동 지원)

### C. AI 고도화 (OpenAI 연동 완료)
- [x] **6. OpenAI provider 연결** ✅ structured output(json_schema) + 룰 fallback + 환각 차단 가드
  - category 1~2개 정확 / hashtags / 옵션 의미론 정규화(이모지·수식어 제거) ✅
  - 환각 차단: detailText 없으면 usp=null, 옵션 null문자열 정리, 개수 불일치 시 fallback
- [x] **7. USP 실제 생성** ✅ AI(openai) 생성 — 상품명+태그+카테고리 근거 (단일 경로)
  - 검증 결과: 네이버 상세는 본문이 이미지, detailContentText는 SEO 키워드(셀러태그와 중복)
  - → 별도 contents 호출 제거 + SEO 키워드 USP 근거에서 제외 (정직성). 전 상품 detailText=false 통일
  - 방어 로직: 다른 몰의 문장형 본문(detailContent)만 추가호출 없이 채택
  - 과장·미입증 효능 금지 프롬프트 + 근거 없으면 validate 차단 / 8개 상품 검증
  - 상세 회고: REFLECTION.md 6번
- [x] (보강) happyland categoryPath 수집 → category 근거 제공 ✅ cateCd→카테고리명(리프 우선, SHOP/ALL/브랜드 필터) 매핑. basis.categoryPath=true, "카테고리경로+상품명" provenance. 추가 호출 0 (목록 SNB 재사용). 검증: 신생아 의류 3상품→"유아 생활"
- [x] **상세이미지 OCR 구현(조건부)** ✅ 근거 부족(셀러태그·본문 없음) 상품만 상세 composite(_DC) OCR → detailText 확보 → USP/hashtags 근거 기반 생성
  - 통짜 OCR 환각(유아 사이즈 80~110→"S/M/L") 확인 → **세로 스트립 분할 + 512px 리사이즈**로 정확도 확보, **동시성 제한+429 재시도**로 TPM 보호 (sharp + gpt-4o-mini vision)
  - `_DC` URL은 raw HTML 정규식 추출(m./www DOM 차이 강건), provenance `상세이미지OCR` 정직 표기, 네이버는 셀러태그 있어 스킵(비용 0)
  - opt-in: `npm run crawl <url> <limit> ocr` 또는 ENABLE_OCR=true / 검증: 코벤트·도티 2상품 grounded USP·hashtags 확인 (REFLECTION #6 정정)

### D. 견고성·품질 (차별화)
- [x] **환각 차단 단일 관문화** ✅ 모든 가드를 validate.ts로 통합
  - USP: detailText 근거 없으면 무효화 / category: 근거없는 다중분류 축소 / 옵션 null문자열 정리
  - **provenance 정직화**: 거짓 "categoryPath 기반" 제거 → 실제 근거만 표기 + meta.basis 투명 공개
  - provider(openai/rule/fallback) 경로 무관하게 최종 산출물은 반드시 관문 통과
- [x] (옵션 견고성) **단일 축 옵션 결정적 처리** ✅ names 1개면 LLM 미호출→룰(결정적). 멀쩡한 단일 옵션을 LLM이 2칸으로 억지분해하다 토큰 중복(예: "드롭스/드롭스/오프너O")시키는 환각 차단. 다축만 LLM 재배치. (검증: 지니어스뉴 3조합 결정적 일치)
- [x] (옵션 provenance 정직화) ✅ 옵션 라벨을 실제 경로 기준으로: 단일 축/rule-baseline→`deterministic`(룰 정규화), 다축+LLM→`ai`(다축 의미배치). 기존엔 단일 축도 `ai/openai`로 거짓표기되던 것 수정 (REFLECTION #5 정직성 원칙)
- [x] **(옵션 LLM 재설계 — 데이터 기반)** ✅ "LLM 의미배치가 밥값 하나?"를 실데이터로 검증(`npm run compare:options`) → ≤2축에선 LLM이 **상품명 누출·뭉침 오염**만 추가함을 확인. 결정: **≤2축은 룰(위치)·LLM 미사용**, **3축+만 LLM**.
  - 3축 오염 차단: LLM 출력에 **grounded·무손실 가드**(self-heal과 같은 원칙) — ① 입력 값 모두 포함(무손실) ② 입력값·구분자 외 잔여 텍스트 없음(무오염). 위반 시 **위치 기반 폴백** → 결과는 항상 "깨끗한 LLM" 또는 "깨끗한 위치값", **절대 안 깨짐**.
  - provenance도 실제 경로(`aiPlaced`)로: 3축 가드통과만 `ai`, ≤2축·폴백은 `deterministic`. 검증: `npm run test:options` **10 pass**(오염·손실·라우팅) + 비교 재실행 시 ≤2축 오염 0.
- [x] 8. 엣지케이스 처리 ✅ 3축 추적(meta.optionAxisCount + 품질 카운트), **품절 양쪽 커버**:
  - 네이버: 상품단위(productStatusType≠SALE — 옵션없는 단일상품도) + 옵션단위(usable/stock). 검증: phytonutri 2페이지 품절 4건 정확
  - 고도몰: 상품단위(구매버튼 클래스 detail_prd_no_btn/btn_add_soldout — fetchDetail시) + 옵션 텍스트마커. 검증: 6873=품절·641=정상
  - 빈옵션·주관식 제외 확인, 에러격리 기존 유지
- [ ] 9. 엣지케이스 카탈로그 문서화 (raw→정규화 예시) — EDGE_CASES.md 최신화 필요(categoryPath·OCR 반영)
- [x] 10. 정제 품질 수치화 ✅ ValidationIssue에 type 추가 → 품질리포트 **유형별 분류**(USP환각·가격이상·옵션정리 등) + **옵션 구조 통계**(단일/1·2·3축/품절). (검증: phytonutri 10상품 리포트 확인)
  - ⚠️ 기존 output(kefii·happyland)은 옛 품질포맷 → 새 필드(byType·options) 반영하려면 재크롤 필요

### E. 가산점 (여유 시)
- [x] **11. lowest_price 실조회** ✅ 네이버쇼핑 OpenAPI(syncNvMid 정확매칭) + 에누리(쿠팡 포함 오픈마켓, 최저가순 DOM 추출) **병렬** 조회. **오탐 방지 3층**:
  - 결정적 가드(가격sanity·브랜드·토큰·단위·**N+M 묶음**) → 강한 신호(**mid·모델코드**)는 확정 → 코드·mid 없는 모호한 후보만 **LLM 동일상품 판정**(여행용·단품·샘플 의미 차단, 키워드 리스트 없이)
  - 쿠폰가 제외(③ 비쿠폰만) / 시장최저>판매가면 판매가 채움(④ 더 낮은=사실) / provenance `pid==mid`·`모델코드확정`·`LLM확인`·`null+사유`
  - 셸 죽은 키로 LLM 401 조용히 폴백하던 버그 발견·수정(dotenv override) → **단일상품 트레이스로 LLM 실동작 확인**
  - 검증: 샘플 5(kefii 3 + happyland 2) **오탐 0 · 과탈락 0**. 전수 규모는 전체 크롤 추가검증 권장. (상세: REFLECTION #7)
  - ⚠️ 기존 output(kefii·happyland·phytonutri)은 lowest_price 미반영 → 채우려면 `npm run crawl <url> <limit> enuri` 재크롤 필요
- [x] **자가복구(self-heal)** ✅ 결정적 추출이 핵심 필드를 비우면 어댑터가 보존한 원본(`rawPayload`)을 LLM에 넘겨 복구. **name + consumer_price(네이버)**.
  - 정직성 가드: ① **grounded**(문자열=substring / 숫자=digit-string 원본존재+양수 sanity → 지어내기 차단) ② provenance **`ai-recovery`** 표기(검수 대상, validate 관문 통과) ③ 평소 추출 성공 시 **LLM 호출 0**(상시 안전망, 빈 필드일 때만 동작)
  - 데모/검증: `SELFHEAL_DEMO=name,consumerPrice` 로 결정적값 강제 제거 → 복구·원본일치 확인. mock 로직테스트 **20 pass**(`npm run test:selfheal`) + `tsc` 통과
  - ⏸️ **옵션 복구는 의도적 보류**: optionCombos 빈값이 "옵션없음"인지 "추출실패"인지 트리거 모호 + LLM이 옵션 추가금을 만들면 "가격은 LLM에 안 맡긴다" 원칙 충돌. 정직한 이름만-복구 버전은 가능하나 ROI 낮아 보류.
- [x] **증분 재크롤(incremental)** ✅ 이전 `output/{store}.json` + `{store}.cache.json`(가격 시그널)과 **목록+배치가격**을 diff → **신규/가격변경 상품만** 무거운 재크롤(상세·OCR·자가복구·최저가), 나머지는 이전 결과 재사용.
  - 변경 시그널 = 가격(consumer/sale) + 존재. 비싼 작업(에누리 브라우저·OCR) 호출 절약 + 크롤 매너(호출 횟수↓). 최초 1회/이전 산출물 없으면 전수 폴백.
  - 사용: `npm run crawl <url> <limit> incremental` / 검증: 순수로직 mock 테스트 **9 pass**(`npm run test:incremental`) + `tsc`
- [x] **검증 하니스 + 합성 샘플** ✅ `npm run verify` — 라이브 크롤 없이 어려운 합성 케이스를 실제 코드(selfHeal→mapper→bundle→validate→incremental)에 통과시켜 전 기능 동작 단언. 스토어 3개×3~4상품 산출 → `samples/{store}.json`(+`.cache.json`, 설명 `samples/README.md`). 평가자가 키·세션 없이 검증 가능.
- [x] **카테고리 분류 재설계(사이트 nav 기반)** ✅ 하드코딩 키워드 제거. 어댑터가 전시 카테고리(nav) 자동수집(네이버 `categoryMenu.firstCategories`: 그로우랩·혈행·갱년기 / 고도몰 `cateNames`: 신생아의류·우주복, 프로모·이모지 필터) → enrich가 "사이트 카테고리 + 상품 상세"로 유아/기타·도메인 판단(7종 의미 정의만).
  - 효과: 혼합몰(파이토뉴트리) 성인약(혈행·갱년)→기타, 베이비→유아 정확 구분 / 유아의류몰 마커없는 의류·잡화(압소바 챙모)→유아 생활.
  - 검증: 실LLM `npm run verify`(test-sitecategory) — phyto 12/12·happy 14/14·kefii 19/20(비유아 충전기 정확 배제)·대량 38/38. 재크롤 반영(블러드플로우→기타 식품 확인). meta.categoryPath 저장(감사).
- [x] **lowest_price 정확도 버그픽스 3종** ✅ (사장님 실관찰로 발견)
  - ① 쿼리: `buildQuery`가 `[브랜드 제품명]` 대괄호 통째 삭제 → 핵심식별자 소실(세트 상품 오매칭). 대괄호 내용 보존 + 브랜드명 앞 강제포함
  - ② LLM 과탈락: 동일상품인데 "정확히 일치" 과해석 + 더 비싼 후보 의심. 프롬프트 완화(같은 제품이면 인정, 절반 이하만 의심, 변종만 배제)
  - ③ ★자기스토어 오인: 긴 쿼리가 자기 스토어 listing만 좁게 잡아 "자기 판매가=최저가"로 표시(옥션이 더 싼데). mid 찾아도 짧은쿼리 보강 항상 수행 → 전체 후보서 진짜 최저 선택. 검증: 누들레이저 1+1 제로파운더스 18,900 → **옥션 18,890** 정정
  - 재크롤 반영: kefii 98%·phyto 93% 채움, 출처몰 다양화(옥션·11번가·현대Hmall·G마켓)
  - ⚠️ 남은 것: "제로파운더스"(셀러명)가 mall로 표시 — 셀러명 vs 쇼핑몰명 분리 미완 / mall 별도 필드화 미완 / happyland는 새 카테고리 미재크롤(옛 분류 잔존)
- [ ] **서비스 배포** — 검수 UI(Next.js)를 Vercel에. (본인 병렬 진행 중)
- [ ] **검수 UI** — output JSON 뷰어 + provenance/복구필드(`ai-recovery`)·공란사유 하이라이트(읽기+검수 플래그)

### F. 제출물 (필수)
- [ ] 12. README (개요/실행법/기술선택/회고/샘플출력/필드별 처리설명)
- [ ] 13. 시연 영상 ≤3분
- [x] 14. GitHub public repo ✅ https://github.com/seongjinYU/quedot-assignment (보안: session·env·도구폴더 제외 확인)
- [ ] 15. (제출 시) 통장 사본 + 신분증

---

## 추천 순서

`1·2·3 (네이버 완성) → 4·5 (스토어) → 8·9·10 (품질) → 6·7 (AI) → 11 (가산점) → 12·13·14 (제출)`

## 필드 채움 현황 (phytonutri 1상품 기준)

| 필드 | 상태 |
|---|---|
| brand_name / name / image_url / consumer_price | ✅ 결정적 |
| hashtags / category_group | ✅ 룰 baseline |
| sales_price / discount_rate | ✅ 가격 배치(product-benefits) |
| option1 / option2 | ✅ 조합 펼침 + 추가금 반영 (묶음·증정 구조화는 LLM 단계) |
| usp | ⏳ 7번 (LLM) |
| lowest_price | ✅ 실조회(네이버쇼핑+에누리) · mid/모델코드/LLM 3층 매칭(오탐 방지) |
