# PROGRESS.md — 진행 상황

> 작업 시작 전 이 파일로 현재 상태 확인. 작업 완료 시 체크 갱신.
> 규칙은 CLAUDE.md, 정찰 정보는 RECON_NOTES.md 참조.

마지막 업데이트: 2026-06-11

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
- [x] 8. 엣지케이스 처리 ✅ 3축 추적(meta.optionAxisCount + 품질 카운트), **품절 양쪽 커버**:
  - 네이버: 상품단위(productStatusType≠SALE — 옵션없는 단일상품도) + 옵션단위(usable/stock). 검증: phytonutri 2페이지 품절 4건 정확
  - 고도몰: 상품단위(구매버튼 클래스 detail_prd_no_btn/btn_add_soldout — fetchDetail시) + 옵션 텍스트마커. 검증: 6873=품절·641=정상
  - 빈옵션·주관식 제외 확인, 에러격리 기존 유지
- [ ] 9. 엣지케이스 카탈로그 문서화 (raw→정규화 예시) — EDGE_CASES.md 최신화 필요(categoryPath·OCR 반영)
- [x] 10. 정제 품질 수치화 ✅ ValidationIssue에 type 추가 → 품질리포트 **유형별 분류**(USP환각·가격이상·옵션정리 등) + **옵션 구조 통계**(단일/1·2·3축/품절). (검증: phytonutri 10상품 리포트 확인)
  - ⚠️ 기존 output(kefii·happyland)은 옛 품질포맷 → 새 필드(byType·options) 반영하려면 재크롤 필요

### E. 가산점 (여유 시)
- [ ] 11. lowest_price (네이버쇼핑 실조회, syncNvMid 매칭, 오탐 방지)

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
| lowest_price | ⏳ 11번 (가산점) |
