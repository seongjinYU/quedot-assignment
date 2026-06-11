// 동일상품 판정(LLM) — 결정적 가드(브랜드·토큰·단위·묶음)를 통과한 '어려운 20%'를 의미로 최종 검수.
//   여행용·샘플·미니·단품·증정 등 변종을 키워드 열거 없이 걸러낸다(키워드 리스트의 두더지잡기 회피).
//   원칙(CLAUDE.md): 룰 우선·LLM은 어려운 20%만 / 확신 없으면 제외(오탐 방지) / 출력은 인덱스 배열+범위검증(환각가드).
import OpenAI from 'openai';

export interface MatchCandidate {
  name: string; // 후보 상품명(에누리 item__model / 네이버 title)
  price: number;
}

export interface MatchJudge {
  /** 기준 상품과 '정확히 같은 상품'(용량·수량·구성·정품 일치)인 후보의 인덱스만 반환. 확신 없으면 제외. */
  sameProduct(target: { name: string; salePrice: number | null }, candidates: MatchCandidate[]): Promise<number[]>;
}

export class OpenAiMatchJudge implements MatchJudge {
  private client: OpenAI;
  constructor(
    apiKey: string,
    private model = 'gpt-4o-mini',
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async sameProduct(
    target: { name: string; salePrice: number | null },
    candidates: MatchCandidate[],
  ): Promise<number[]> {
    if (candidates.length === 0) return [];
    const list = candidates.map((c, i) => `[${i}] ${c.name} — ${c.price.toLocaleString()}원`).join('\n');
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            '너는 가격비교 매칭 검수자다. 기준 상품과 "정확히 같은 상품"인 후보의 인덱스만 고른다. ' +
            '동일 기준: 용량·수량·구성·세트여부·정품여부가 모두 일치해야 한다. ' +
            '여행용·트래블·미니·샘플·체험·단품·증정·리필·테스터 등은 다른 상품으로 본다. ' +
            '가격이 기준 판매가의 절반 수준이면 보통 단품/소용량이니 의심하라. ' +
            '확신이 없으면 제외한다(추측 금지). 같은 상품이 없으면 빈 배열을 반환하라.',
        },
        {
          role: 'user',
          content:
            `기준 상품: ${target.name}${target.salePrice ? ` (판매가 ${target.salePrice.toLocaleString()}원)` : ''}\n\n` +
            `후보:\n${list}\n\n동일 상품인 후보의 인덱스만 골라라.`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'match',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { matches: { type: 'array', items: { type: 'integer' } } },
            required: ['matches'],
          },
        },
      },
    });
    const p = JSON.parse(res.choices[0].message.content ?? '{}');
    if (!Array.isArray(p.matches)) return [];
    // 환각 가드: 범위 내 정수만 채택 (없는 인덱스·중복 제거)
    const seen = new Set<number>();
    return p.matches.filter((n: unknown): n is number => {
      if (!Number.isInteger(n) || (n as number) < 0 || (n as number) >= candidates.length) return false;
      if (seen.has(n as number)) return false;
      seen.add(n as number);
      return true;
    });
  }
}
