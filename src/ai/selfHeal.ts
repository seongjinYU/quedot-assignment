// 자가복구(self-heal) — 결정적 추출이 핵심 필드를 비웠을 때(셀렉터/JSON 구조 변경 등),
// 어댑터가 보존한 원본 payload를 LLM에 넘겨 그 필드만 재분석·복구한다.
// "룰 우선, LLM은 어려운 20%만" 원칙의 완성: LLM을 주력이 아니라 추출이 깨졌을 때의 안전망으로만 사용.
//
// 정직성(절대 규칙):
//   ① grounded — 복구값이 원본 payload에 문자 그대로 존재해야만 채택(지어내기 차단).
//       · 문자열: 부분일치(substring). · 숫자: digit-string 존재 + 양수 sanity(우연일치·환각 차단).
//   ② provenance 'ai-recovery' 표기 → validate 단일 관문 통과 + 검수 UI가 "확인 필요"로 노출.
//   ③ 평소엔 결정적 추출이 성공하므로 LLM 호출 0 — 필드가 실제로 빌 때만 동작.
import OpenAI from 'openai';
import type { RawProduct } from '../adapters/types.js';

/** 복구 대상 필드 스펙 (RawProduct의 스칼라 필드). key=raw필드, type=grounding 방식, label=LLM 지시문 */
interface FieldSpec {
  key: keyof RawProduct;
  type: 'string' | 'number';
  label: string;
}
const FIELD_SPECS = {
  name: { key: 'name', type: 'string', label: '상품명(원문 그대로)' },
  consumerPrice: { key: 'consumerPrice', type: 'number', label: '정가/소비자가(숫자만, 옵션 추가금 제외한 기본가)' },
} as const satisfies Record<string, FieldSpec>;

export type RecoverableField = keyof typeof FIELD_SPECS;
export const RECOVERABLE = Object.keys(FIELD_SPECS) as RecoverableField[];

export interface SelfHealReport {
  productNo: string;
  injected: string[]; // 데모/테스트로 강제 실패시킨 필드 (SELFHEAL_DEMO)
  recovered: { field: string; value: string | number; confidence: number; matchedInjected?: boolean }[];
  failed: { field: string; reason: string }[];
}

const isEmpty = (v: any): boolean => v == null || (typeof v === 'string' && v.trim().length === 0);
/** 가격 문자열 정리("18,300원"→18300). 정수 KRW 가정. */
const parseNum = (v: any): number | null => {
  const digits = String(v).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
};

export class SelfHealer {
  readonly kind = 'openai-selfheal';
  constructor(
    private client: OpenAI,
    private opts: { fields?: RecoverableField[]; faultInject?: string[]; model?: string } = {},
  ) {}

  /** raw의 핵심 필드 누락을 원본 payload로 복구(in-place). 반환은 로깅·검수용 리포트. */
  async heal(raw: RawProduct): Promise<SelfHealReport> {
    const fields = this.opts.fields ?? RECOVERABLE;
    const report: SelfHealReport = { productNo: raw.productNo, injected: [], recovered: [], failed: [] };

    // 데모/테스트 하니스: 결정적으로 추출된 값을 일부러 제거해 복구 경로를 재현 가능하게 강제.
    //   프로덕션 동작이 아님(SELFHEAL_DEMO 지정 시에만). 복구 정확도 비교용으로 원본 보존.
    const injectedOriginals: Record<string, any> = {};
    for (const f of this.opts.faultInject ?? []) {
      const spec = (FIELD_SPECS as Record<string, FieldSpec>)[f];
      if (spec && fields.includes(f as RecoverableField) && !isEmpty(raw[spec.key])) {
        injectedOriginals[f] = raw[spec.key];
        (raw as any)[spec.key] = null;
        report.injected.push(f);
      }
    }

    // 결정적 추출이 비운 필드만 복구 대상 (값이 있으면 건너뜀 → 평소 LLM 호출 0)
    const missing = fields.filter((f) => isEmpty(raw[FIELD_SPECS[f].key]));
    if (missing.length === 0 || !raw.rawPayload) return report;

    let recovered: Record<string, string | null>;
    try {
      recovered = await this.askLLM(missing, raw.rawPayload);
    } catch (e: any) {
      for (const f of missing) report.failed.push({ field: f, reason: `LLM 실패: ${e.message}` });
      return report;
    }

    const payloadLc = raw.rawPayload.toLowerCase();
    for (const f of missing) {
      const spec = FIELD_SPECS[f];
      const rawVal = recovered[f];
      if (rawVal == null || String(rawVal).trim() === '') {
        report.failed.push({ field: f, reason: '원본에서 값 못 찾음' });
        continue;
      }

      let value: string | number;
      if (spec.type === 'number') {
        const n = parseNum(rawVal);
        // sanity: 양수 + digit-string이 원본에 실제 존재(숫자 우연·환각 차단)
        if (n == null || n <= 0) {
          report.failed.push({ field: f, reason: `숫자 파싱/범위 실패("${rawVal}")` });
          continue;
        }
        if (!payloadLc.includes(String(n))) {
          report.failed.push({ field: f, reason: `grounded 실패(원본에 숫자 ${n} 없음)` });
          continue;
        }
        value = n;
      } else {
        const v = String(rawVal).trim();
        // ① grounded: 복구값이 원본 payload에 실제 존재(엄격 substring) — 통과 못 하면 채우지 않음(추측 금지)
        if (!payloadLc.includes(v.toLowerCase())) {
          report.failed.push({ field: f, reason: `grounded 실패(원본에 "${v.slice(0, 20)}…" 없음)` });
          continue;
        }
        value = v;
      }

      (raw as any)[spec.key] = value;
      raw.recovered = { ...(raw.recovered ?? {}), [f]: { confidence: 0.9 } };
      report.recovered.push({
        field: f,
        value,
        confidence: 0.9,
        matchedInjected: f in injectedOriginals ? injectedOriginals[f] === value : undefined,
      });
    }
    return report;
  }

  /** 원본 payload에서 누락 필드만 추출하도록 LLM에 요청 (grounded·structured output). */
  private async askLLM(fields: RecoverableField[], payload: string): Promise<Record<string, string | null>> {
    // 토큰 보호: 원본이 크면 앞부분만(핵심 필드는 보통 상단). grounded 검증은 전체 원본으로 별도 수행.
    const trimmed = payload.length > 12000 ? payload.slice(0, 12000) : payload;
    const properties: Record<string, any> = {};
    const directives: string[] = [];
    for (const f of fields) {
      const spec = FIELD_SPECS[f];
      // 숫자도 문자열로 받아 호출부에서 파싱(콤마·단위 견고). 없으면 null.
      properties[f] = { type: ['string', 'null'] };
      directives.push(`- ${f}: ${spec.label}`);
    }

    const res = await this.client.chat.completions.create({
      model: this.opts.model ?? 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            '너는 깨진 파서를 대신해 상품 원본 데이터(JSON/HTML)에서 필드를 복구하는 도우미다. ' +
            '원본에 문자 그대로 존재하는 값만 추출하라. 추론·번역·요약·계산·생성 금지. 없으면 null.',
        },
        {
          role: 'user',
          content:
            `원본 payload:\n${trimmed}\n\n` +
            `추출할 필드(원본에 나타난 그대로, 없으면 null):\n${directives.join('\n')}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'recover',
          strict: true,
          schema: { type: 'object', additionalProperties: false, properties, required: fields },
        },
      },
    });
    const p = JSON.parse(res.choices[0].message.content ?? '{}');
    const out: Record<string, string | null> = {};
    for (const f of fields) out[f] = typeof p[f] === 'string' ? p[f] : null;
    return out;
  }
}
