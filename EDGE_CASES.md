# 엣지케이스 카탈로그 & 정제 품질 리포트

> 실제 3개 스토어 전수 크롤링 데이터 기반 (2026-06-10)
> 데이터: output/{phytonutri,kefii,happylandmall}.json + *.quality.json
> "정제했다"가 아니라 "무엇을 어떻게 처리했고, 못한 것은 왜인지"를 숫자와 사례로 증명.

---

## 1. 정제 품질 수치 (필드별 채움률)

### phytonutri (네이버 스마트스토어) — 원상품 59개 → 103 SKU
| 필드 | 채움률 | 방식 |
|---|---|---|
| brand_name / name / image_url | 100% | 결정적 |
| consumer_price / sales_price | 100% | 결정적 78 + 계산(옵션추가금) 25 |
| discount_rate | 90.3% | 계산 (10건은 가격 일부 누락→공란) |
| hashtags / usp / category_group | 100% | **AI(openai)** |
| option1 / option2 | 43.7% / 42.7% | AI 정규화 (나머지는 단일상품=옵션없음) |
| lowest_price | 0% | 가산점 미구현(매칭키 syncNvMid 확보) |
| **실패** | **0건** | 에러 격리 정상 |
| **AI fallback** | **0행** | openai 안정(103행 전부 enrich) |

### happylandmall (고도몰 공식몰) — 원상품 200개 → 874 SKU
| 필드 | 채움률 | 방식 |
|---|---|---|
| brand_name / name / image_url | 100% | 결정적 |
| consumer_price / sales_price | 100% | 결정적 (정가판매) |
| discount_rate | 100% | 계산 (할인 없어 0%) |
| hashtags / category_group | 100% | AI |
| option1 / option2 | 100% / 97% | AI 정규화 |
| **usp** | **0%** | ⚠️ 근거 부족(태그·카테고리 미수집)으로 **환각 차단** |
| lowest_price | 0% | 가산점 미구현 |

### 핵심 인사이트 (두 스토어 대조)
- **네이버 USP 100% vs happyland 0%** — 차이는 "근거 데이터 유무".
  네이버는 sellerTags·categoryPath 보유 → USP 생성. happyland는 미수집 → **지어내지 않고 정직하게 공란**.
  → 이것이 "AI 출력을 신뢰하지 않는다 / 근거 없으면 비운다" 원칙의 실증.
- happyland의 error 874건 = 전부 "usp 환각 차단"(정상 동작). 검증 관문이 근거 없는 생성을 막은 횟수.

---

## 2. 엣지케이스 카탈로그 (실데이터 사례)

### A. 옵션 추가금 (옵션별 가격 차이)
정가에 옵션 추가금을 더해 SKU별 실제 가격 산출.
| 원본 옵션 | 처리 결과 |
|---|---|
| 톡캡스 1개 (+23,000) | consumer_price 46,000 → **69,000** |
| 드롭스 10병+그로우뉴4개 (묶음) | → **651,100원** |
| 드롭스 5병+그로우뉴2개 | → **544,800원** |

### B. 옵션 텍스트 노이즈 제거 (AI 정규화)
| 원본 (raw) | 정규화 후 |
|---|---|
| `💧 지니어스뉴 드롭스 1개/오프너O` | option1: `지니어스뉴 드롭스` / option2: `오프너O / 1개` |
| `★NEW★케피 바디워시 블루베리웨이브` | `케피 바디워시 블루베리웨이브` (★NEW★ 제거) |
| `[필수] 제품선택` | 수식어 제거 |

### C. 옵션 축 다양성
| 유형 | 사례 | 처리 |
|---|---|---|
| 1축 (COMBINATION) | 지니어스뉴: 제품선택 3종 | 조합별 펼침 |
| 2축 | kefii 버블클렌저: 구성×색상 (12조합) | option1/option2 분리 |
| SIMPLE형 | 투데이디: options[]에 직접 | 1축 펼침 |
| 단일상품 (옵션없음) | phytonutri 47건 | option=null + 사유 |
| 색상:사이즈 (고도몰) | `백IVORY:50` | 콜론 분리 → option1/option2 |

### D. 구조적 한계 — 3축 이상 옵션 (큐닷 스키마 2칸 제약)
- 큐닷 `option1`/`option2`는 2칸뿐, 네이버/고도몰은 최대 3축.
- 3축은 option2에 결합(`A / B`). **874 SKU 중 9건(1%)만** 해당 → 영향 미미하나 회고에 명시.

### E. 가격/할인 구조
| 케이스 | 처리 |
|---|---|
| 즉시할인 (네이버) | consumer_price(정가) vs sales_price(할인가) 분리, discount_rate 계산 |
| 정가판매 (happyland) | 할인 표시 없음 → 정가=판매가, discount_rate 0% |
| 배송비 조건부무료 | base/freeOver 수집 (실결제 보조) |

---

## 3. 검증 관문이 잡아낸 것 (validate.ts 단일 관문)
| 검증 항목 | 동작 |
|---|---|
| USP 환각 | 근거(상세본문/태그/카테고리) 없으면 무효화 → happyland 874건 차단 |
| category 7종 enum | 범위 밖 라벨 제거 |
| category 근거없는 다중분류 | 1개로 축소(저신뢰 표기) |
| 옵션 "null" 문자열 | 빈값 정리 |
| 음수/비정상 가격 | 무효화 + 사유 |
| 판매가 > 정가 | 경고 |
| provenance 정직화 | 무효화 시 method=empty+사유로 갱신 (거짓 근거 표기 방지) |

---

## 4. 못 채운 것 (정직한 공란 + 사유)
| 필드 | 사유 | 향후 |
|---|---|---|
| lowest_price | 가산점 미구현 | 매칭키 syncNvMid 확보 → 네이버쇼핑 실조회 |
| usp (happyland) | 태그·카테고리 미수집으로 근거 부족 | happyland 어댑터에 카테고리명 보강 시 해결 |
| option (단일상품) | 옵션 없는 상품 | 정상 (해당없음) |

→ 모든 공란은 `provenance`에 method=empty + reason으로 기록. 검수자가 "왜 비었는지" 즉시 확인 가능.
