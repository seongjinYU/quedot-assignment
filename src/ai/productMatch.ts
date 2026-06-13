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
            '너는 가격비교 매칭 검수자다. 기준 상품과 "같은 상품"(다른 쇼핑몰에 올라온 동일 제품)인 후보의 인덱스를 고른다. ' +
            '판단 기준: 브랜드·제품명·핵심 구성(용량·수량·세트)이 일치하면 같은 상품이다. ' +
            '상품명 표기가 조금 다르거나(띄어쓰기·수식어 순서) 다른 몰에서 더 비싸/싸게 팔아도, 같은 제품이면 인정한다. ' +
            '제외할 것(다른 상품): 여행용·트래블·미니·샘플·체험·증정전용·리필·테스터, 수량/용량이 다른 것(10병 vs 1병, 6종 vs 3종). ' +
            '★특히 기준 상품이 여러 품목을 묶은 "복합 세트/번들"(예: A + B + 증정 C)이면 엄격하게 본다: ' +
            '후보가 그 구성품을 똑같이 갖추지 않으면(품목 종류·개수·증정 구성이 다르면) 비슷한 이름이어도 다른 상품이니 제외하라. ' +
            '복합 번들은 시장에 완전히 같은 구성이 없을 때가 많고, 그럴 땐 빈 배열을 반환하는 게 옳다 — 억지로 비슷한 세트를 고르지 마라. ' +
            '가격이 기준 판매가의 절반 이하로 낮으면 단품/소용량일 수 있으니 그때만 의심하라(더 비싼 건 정상이니 의심하지 마라). ' +
            '단순 단일 상품은 표기 차이를 너그럽게 보되, 복합 구성이 다르면 가격이 싸도 제외하라.',
        },
        {
          role: 'user',
          content:
            `기준 상품: ${target.name}${target.salePrice ? ` (우리 판매가 ${target.salePrice.toLocaleString()}원)` : ''}\n\n` +
            `후보:\n${list}\n\n같은 상품인 후보의 인덱스만 골라라(없으면 빈 배열).`,
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
