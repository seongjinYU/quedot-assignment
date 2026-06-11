# samples/ — 파이프라인 검증 샘플 (합성 hard 케이스)

> ⚠️ 이 디렉터리는 **라이브 크롤 결과가 아니라**, 전체 파이프라인이 제대로 동작하는지
> 검증하기 위한 **합성(synthetic) hard 케이스**다. 라이브 크롤은 네이버 본인 로그인 세션 +
> NAVER/OPENAI 키 + 실시간 접속이 필요해 재현이 어렵기 때문에, 까다로운 입력을 직접 만들어
> **실제 코드**(`selfHeal → mapper → bundle → validate → incremental`)에 통과시킨 결과다.
>
> 실데이터 산출물은 상위 `output/{store}.json`(라이브 크롤). 라이브 전용 기능
> (lowest_price 실조회, 실 LLM 자가복구)은 `npm run crawl <url> <limit> enuri` 재크롤로 검증.

## 재생성

```bash
npm run verify   # = npx tsx verify/verify-pipeline.ts
```

콘솔에 기능별 단언(✓)이 출력되고 `samples/{phytonutri,kefii,happylandmall}.json`(+`.cache.json`)이 갱신된다.

## 각 샘플이 증명하는 것

| 스토어 / 상품 | 증명 기능 | 확인 포인트(파일에서) |
|---|---|---|
| **phytonutri A1** | 3축 옵션 펼침 + 추가금 + 3축 추적 | `meta.optionAxisCount: 3`, SKU 3건 정가 25000/33000/40000 |
| **phytonutri A2** | ★ **자가복구(상품명)** — 결정적 추출 실패(name=null)를 원본 `goodsName`에서 LLM 복구 | `provenance.name.method: "ai-recovery"`, `meta.recovered: [{name}]` |
| **phytonutri A3** | 품절 — 옵션 없는 단일상품의 상품단위 품절 감지 | `meta.soldOut: true` |
| **phytonutri A4** | 단일 축 옵션 → 결정적 provenance(LLM 미사용) | `provenance.option1.method: "deterministic"` |
| **kefii B1** | ★ **자가복구(정가)** — consumer_price=null을 원본 숫자에서 grounded 복구(+양수 sanity) | `provenance.consumer_price.method: "ai-recovery"`, 값 32700 |
| **kefii B2** | 묶음(골라담기 N+M) → bundle 2-pass | `meta.bundle`(보정 시도) |
| **kefii B3** | 2축 옵션(향×구성) SKU 펼침 + 추가금 | SKU 2건, 19000 / 28000 |
| **happylandmall C1** | 고도몰 2축(색상:사이즈) + 추가금 | SKU 2건, 39000 / 41000 |
| **happylandmall C2** | ★ **환각 차단** — 근거 전무인데 LLM이 지어낸 USP를 validate가 무효화 | `data.usp: null`, `provenance.usp.method: "empty"` |
| **happylandmall C3** | 정상 단일상품(대조군) | 결정적 필드 + rule baseline AI |

## 증분 재크롤 시나리오 (phytonutri)

`verify/verify-pipeline.ts`가 "다음날" 상황을 시뮬레이션:
- A1 판매가 변경(19900→17900), A5 신규, A2~A4 그대로
- → **재크롤 [A1, A5]**(가격변경/신규)만, **재사용 [A2, A3, A4]** — 비싼 작업(상세·OCR·자가복구·최저가) 생략

## 정직성 메모

- 자가복구 값은 **원본에 실제 존재하는 값만**(grounded) 채우고 `ai-recovery`로 표기 → 검수 대상.
- 합성 케이스의 self-heal LLM은 **토큰 0 mock**(원본에서 grounded 추출 시뮬). 실 LLM 동작은 재크롤 시 `SELFHEAL_DEMO=name,consumerPrice`로 확인.
- enricher는 `RuleEnricher`(결정적) 사용 — category/hashtags 환각 없이 파이프라인 골격 검증에 집중.
