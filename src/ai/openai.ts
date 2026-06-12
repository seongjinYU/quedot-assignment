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
import { RuleEnricher, cleanOptionText } from './rule.js';

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
              `큐닷 7종 분류(괄호=의미):\n` +
              `· 유아 식품 / 유아 건강(영양제·비타민·유산균) / 유아 놀이 교육(완구·장난감·놀이) / 유아 생활(의류·신발·잡화·목욕·세정·위생 등 일상용품)\n` +
              `· 기타 식품 / 기타 여행 / 기타 리빙   (유아=아기·어린이 대상, 기타=성인·일반 대상)\n\n` +
              `이 스토어가 취급하는 카테고리:\n${(input.siteCategories ?? []).join(' | ') || '(미상)'}\n\n` +
              `상품 정보:\n${JSON.stringify({ name: input.name, categoryPath: input.categoryPath, sellerTags: input.sellerTags, detailText: input.detailText }, null, 1)}\n\n` +
              `위 스토어 카테고리로 이 스토어 성격(유아 전용/성인·일반/혼합)을 파악하고, 상품을 7종 중 가장 맞는 1개로 분류하라.\n` +
              `- hashtags: 핵심 키워드 3~8개(detailText 있으면 소재·특징 반영).\n` +
              `- usp: 확인되는 사실만으로 한 문장(과장·없는 효능·인증 금지, 근거 없으면 빈 문자열).`,
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

    // 라우팅(데이터 기반 결정): 축 2개 이하는 룰(위치 기반·결정적), 3축 이상만 LLM.
    //   근거: 실데이터 검증 결과 ≤2축은 위치 기반이면 충분하고, LLM은 상품명 누출·뭉침 오염만 추가했다.
    //         3축→2칸 압축만 "어려운 20%"라 LLM을 쓰되, grounded·무손실 가드로 오염을 원천 차단한다.
    const results: (OptionNormalized | null)[] = new Array(combos.length).fill(null);
    const llmIdx: number[] = [];
    const llmCombos: OptionNormalizeInput[] = [];
    const ruleIdx: number[] = [];
    const ruleCombos: OptionNormalizeInput[] = [];
    combos.forEach((c, i) => {
      if (c.names.filter(Boolean).length >= 3) {
        llmIdx.push(i);
        llmCombos.push(c);
      } else {
        ruleIdx.push(i);
        ruleCombos.push(c);
      }
    });

    // ≤2축: 룰 결정적 정규화(이모지·수식어 제거, 위치 기반)
    if (ruleCombos.length > 0) {
      const out = await this.fallback.normalizeOptions(ruleCombos);
      ruleIdx.forEach((origIdx, k) => (results[origIdx] = out[k]));
    }

    // 3축+: LLM 의미배치 → grounded·무손실 가드(통과 못하면 위치 기반 폴백). 폴백용 위치값 미리 산출.
    if (llmCombos.length > 0) {
      const fallback = await this.fallback.normalizeOptions(llmCombos);
      const llmOut = await this.llmNormalizeMultiAxis(llmCombos, ctx);
      llmIdx.forEach((origIdx, k) => {
        // LLM 실패(내부 폴백, aiPlaced=false)는 가드 생략. LLM 성공분만 grounded 검증.
        results[origIdx] = llmOut[k].aiPlaced
          ? guardOptionOutput(llmOut[k], llmCombos[k].names, fallback[k])
          : { ...fallback[k], aiPlaced: false };
      });
    }

    return results.map((r) => r ?? { option1: null, option2: null, aiPlaced: false });
  }

  /** 3축+ 옵션 의미론 정규화 (LLM). ≤2축은 호출부에서 이미 룰(결정적) 처리됨. */
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
              '옵션 텍스트를 큐닷 제안서용 2칸으로 재배치한다. ' +
              'option1=상품 종류/색상/맛, option2=구성/수량/용량. ' +
              '"[필수]","★특가★","선택" 같은 판매자 수식어와 이모지를 제거한다. ' +
              '⚠️ 입력 옵션 값에 실제로 있는 텍스트만 사용하라. 상품명·축 제목·새 단어를 절대 추가하지 마라(원본 값만 재배치). ' +
              '입력의 모든 값이 option1·option2 어딘가에 빠짐없이 담겨야 한다. ' +
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
      // null문자열/빈값 정리는 validate.ts(단일 관문)가 담당. 여기선 타입만 정돈. aiPlaced=true로 표시(가드 대상).
      return p.results.map((r: any) => ({
        option1: typeof r.option1 === 'string' ? r.option1 : null,
        option2: typeof r.option2 === 'string' ? r.option2 : null,
        aiPlaced: true,
      }));
    } catch (e: any) {
      console.log(`  ⚠️ OpenAI 옵션정규화 실패 → 룰 fallback (${e.message})`);
      return this.fallback.normalizeOptions(combos);
    }
  }
}

/**
 * LLM 옵션 출력 grounded·무손실 가드 (self-heal과 같은 정직성 원칙).
 *   ① 무손실: 입력 옵션 값이 모두 출력(option1+option2)에 담겼는지 — 누락 SKU 방지.
 *   ② 무오염: 입력 값·구분자를 제거한 뒤 의미있는 잔여 텍스트가 없어야 — 상품명 누출·새 단어 차단.
 * 둘 중 하나라도 실패하면 위치 기반 폴백(fallback)을 쓴다 → 결과는 항상 "깨끗한 LLM" 또는 "깨끗한 위치값". 절대 안 깨짐.
 */
function guardOptionOutput(
  llm: OptionNormalized,
  names: string[],
  fallback: OptionNormalized,
): OptionNormalized {
  // 긴 값부터 제거(부분문자열 과다제거 방지). 입력 값 = grounded 어휘.
  const inputs = names
    .map((n) => cleanOptionText(n))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (inputs.length === 0) return { ...fallback, aiPlaced: false };

  const combined = `${llm.option1 ?? ''} ${llm.option2 ?? ''}`;
  // ① 무손실: 모든 입력 값이 출력에 포함
  const lossless = inputs.every((v) => combined.includes(v));
  // ② 무오염: 입력 값·구분자·null 제거 후 잔여 문자(한글/영숫자) 없음
  let residue = combined;
  for (const v of inputs) residue = residue.split(v).join(' ');
  residue = residue.replace(/null|undefined/gi, '').replace(/[\s/·,+()\-]/g, '');
  const noForeign = residue.length === 0;

  if (lossless && noForeign) return { option1: llm.option1, option2: llm.option2, aiPlaced: true };
  return { ...fallback, aiPlaced: false }; // 손실 또는 오염 → 위치 기반 폴백(결정적)
}
