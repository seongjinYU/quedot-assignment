// OpenAI enricher — structured output(json_schema)로 환각 차단 + 룰 fallback
// 용도(명세): 카테고리 분류 / 해시태그 / USP / 옵션 텍스트 의미론 정규화
// 원칙: 원본에 없는 값 생성 금지, 7종 enum 강제, 실패 시 룰 baseline으로 안전 강등
import OpenAI from 'openai';
import type {
  Enricher,
  EnrichInput,
  EnrichResult,
  OptionNormalizeInput,
  OptionNormalized,
} from './provider.js';
import { CATEGORY_GROUPS } from '../normalize/schema.js';
import { RuleEnricher } from './rule.js';

export class OpenAiEnricher implements Enricher {
  readonly kind = 'openai';
  private client: OpenAI;
  private fallback = new RuleEnricher();

  constructor(
    apiKey: string,
    private model = 'gpt-4o-mini',
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async enrich(input: EnrichInput): Promise<EnrichResult> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              '너는 이커머스(육아 공동구매) 상품 데이터를 분류·정제하는 도우미다. ' +
              '원본에 없는 정보를 지어내지 마라. 근거가 없으면 빈 값을 반환하라.',
          },
          {
            role: 'user',
            content:
              `상품 정보:\n${JSON.stringify(input, null, 1)}\n\n` +
              `- category_group: 7종 중 가장 적합한 1개만 선택. 명확히 두 영역에 걸칠 때만 최대 2개. 억지로 여러 개 고르지 마라.\n` +
              `  (의류·잡화·생활용품은 "유아 생활" 또는 "기타 리빙", 영양제·건강식품은 "유아 건강")\n` +
              `- hashtags: 상품 핵심 키워드 3~8개(노이즈/중복 제거). detailText(상세설명)가 있으면 거기서 소재·특징도 반영.\n` +
              `- usp: 상품명·태그·카테고리·detailText(상세설명)에서 확인되는 사실만으로 한 문장 소구점. ` +
              `detailText에 소재·기능·사이즈 등 구체 정보가 있으면 우선 활용하라. ` +
              `과장·미입증 효능(예: 질병 예방·치료)·없는 인증을 지어내지 마라. 근거가 전혀 없으면 빈 문자열.`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'enrich',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                category_group: { type: 'array', items: { type: 'string', enum: [...CATEGORY_GROUPS] } },
                hashtags: { type: 'array', items: { type: 'string' } },
                usp: { type: 'string' },
              },
              required: ['category_group', 'hashtags', 'usp'],
            },
          },
        },
      });
      const p = JSON.parse(res.choices[0].message.content ?? '{}');
      // 환각/근거 가드는 validate.ts(단일 관문)가 담당. 여기선 LLM 원출력을 그대로 전달.
      return {
        category_group: p.category_group ?? [],
        hashtags: p.hashtags ?? [],
        usp: p.usp ? String(p.usp) : null,
      };
    } catch (e: any) {
      console.log(`  ⚠️ OpenAI enrich 실패 → 룰 fallback (${e.message})`);
      return this.fallback.enrich(input);
    }
  }

  async normalizeOptions(
    combos: OptionNormalizeInput[],
    ctx: { productName: string | null },
  ): Promise<OptionNormalized[]> {
    if (combos.length === 0) return [];

    // 단일 축(값 1개)은 LLM에 맡기지 않고 결정적(룰)으로 처리.
    // 이유: 멀쩡한 단일 옵션을 LLM이 2칸으로 억지 분해하다 토큰을 중복·누락시키는 환각 방지.
    //       (원칙: 룰 우선 — 쉬운 80%는 코드로, LLM은 다축 의미론 재배치 같은 어려운 20%만)
    const results: (OptionNormalized | null)[] = new Array(combos.length).fill(null);
    const llmIdx: number[] = [];
    const llmCombos: OptionNormalizeInput[] = [];
    combos.forEach((c, i) => {
      if (c.names.filter(Boolean).length <= 1) {
        results[i] = null; // 아래에서 룰 baseline으로 일괄 채움
      } else {
        llmIdx.push(i);
        llmCombos.push(c);
      }
    });

    // 단일 축: 룰 enricher의 결정적 정규화(이모지·수식어 제거, option1=원문, option2=null)
    const singleCombos = combos.filter((c) => c.names.filter(Boolean).length <= 1);
    if (singleCombos.length > 0) {
      const ruleOut = await this.fallback.normalizeOptions(singleCombos);
      let k = 0;
      for (let i = 0; i < combos.length; i++) {
        if (results[i] === null && combos[i].names.filter(Boolean).length <= 1) {
          results[i] = ruleOut[k++];
        }
      }
    }

    // 다축이 없으면 LLM 호출 자체를 생략 (비용·환각 회피)
    if (llmCombos.length === 0) {
      return results.map((r) => r ?? { option1: null, option2: null });
    }

    // 다축(2개 이상)만 LLM에 보내 의미론 재배치 후 원래 위치에 병합
    const llmOut = await this.llmNormalizeMultiAxis(llmCombos, ctx);
    llmIdx.forEach((origIdx, k) => {
      results[origIdx] = llmOut[k];
    });
    return results.map((r) => r ?? { option1: null, option2: null });
  }

  /** 다축 옵션 의미론 정규화 (LLM). 단일 축은 호출부에서 이미 결정적 처리됨. */
  private async llmNormalizeMultiAxis(
    combos: OptionNormalizeInput[],
    ctx: { productName: string | null },
  ): Promise<OptionNormalized[]> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              '옵션 텍스트를 큐닷 제안서용으로 정규화한다. ' +
              'option1=상품 종류/색상/맛, option2=구성/수량/용량. ' +
              '"[필수]","★특가★","선택" 같은 판매자 수식어와 이모지를 제거한다. ' +
              '입력 순서를 그대로 유지하고, 가격이나 새 정보를 만들지 마라. ' +
              '해당 정보가 없으면 문자열 "null"이 아니라 JSON null 값을 사용한다. 빈 문자열도 쓰지 마라.',
          },
          {
            role: 'user',
            content: `상품명: ${ctx.productName ?? ''}\n옵션 조합(순서 유지):\n${JSON.stringify(combos)}`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'options',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      option1: { type: ['string', 'null'] },
                      option2: { type: ['string', 'null'] },
                    },
                    required: ['option1', 'option2'],
                  },
                },
              },
              required: ['results'],
            },
          },
        },
      });
      const p = JSON.parse(res.choices[0].message.content ?? '{}');
      // 안전장치: 개수 불일치 시 룰 fallback (가격-옵션 매핑 어긋남 방지 — provider 책임)
      if (!Array.isArray(p.results) || p.results.length !== combos.length) {
        return this.fallback.normalizeOptions(combos);
      }
      // null문자열/빈값 정리는 validate.ts(단일 관문)가 담당. 여기선 타입만 정돈.
      return p.results.map((r: any) => ({
        option1: typeof r.option1 === 'string' ? r.option1 : null,
        option2: typeof r.option2 === 'string' ? r.option2 : null,
      }));
    } catch (e: any) {
      console.log(`  ⚠️ OpenAI 옵션정규화 실패 → 룰 fallback (${e.message})`);
      return this.fallback.normalizeOptions(combos);
    }
  }
}
