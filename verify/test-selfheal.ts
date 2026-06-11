// 자가복구 로직 검증 — mock OpenAI 클라이언트로 API 비용·세션 없이 결정적 테스트.
//   실 e2e(LLM 실호출)는 재크롤 시 SELFHEAL_DEMO=name 으로 확인.
import { SelfHealer } from '../src/ai/selfHeal.js';
import type { RawProduct } from '../src/adapters/types.js';

let pass = 0,
  fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
};

// 호출되면 returnValue를 그대로 돌려주는 mock. throwOnCall=true면 "LLM 호출 0" 검증용.
const mockClient = (returnValue: Record<string, string | null>, throwOnCall = false): any => ({
  chat: {
    completions: {
      create: async () => {
        if (throwOnCall) throw new Error('LLM이 호출되면 안 되는데 호출됨');
        return { choices: [{ message: { content: JSON.stringify(returnValue) } }] };
      },
    },
  },
});

const baseRaw = (over: Partial<RawProduct>): RawProduct => ({
  productNo: '123',
  name: null,
  sourceUrl: 'x',
  rawPayload: JSON.stringify({ id: 123, name: '케피 버블클렌저 3개', price: 18300 }),
  ...over,
});

async function run() {
  // ① 누락 감지 + grounded 통과 → 복구
  console.log('① name=null + 원본에 존재 → 복구');
  {
    const raw = baseRaw({ name: null });
    const healer = new SelfHealer(mockClient({ name: '케피 버블클렌저 3개' }), { fields: ['name'] });
    const r = await healer.heal(raw);
    ok(raw.name === '케피 버블클렌저 3개', `raw.name 복구됨 (${raw.name})`);
    ok(raw.recovered?.name?.confidence === 0.9, 'raw.recovered.name 기록됨');
    ok(r.recovered.length === 1 && r.recovered[0].field === 'name', '리포트에 recovered 기록');
    ok(r.failed.length === 0, '실패 0');
  }

  // ② grounded 차단: LLM이 원본에 없는 값을 반환 → 채우지 않고 실패 처리(환각 차단)
  console.log('② LLM이 원본에 없는 값 반환 → grounded 차단(채우지 않음)');
  {
    const raw = baseRaw({ name: null });
    const healer = new SelfHealer(mockClient({ name: '있지도않은상품명ZZZ' }), { fields: ['name'] });
    const r = await healer.heal(raw);
    ok(raw.name === null, 'raw.name 여전히 null (지어낸 값 거부)');
    ok(raw.recovered == null, 'raw.recovered 미기록');
    ok(r.failed.length === 1 && r.failed[0].reason.includes('grounded'), '리포트에 grounded 실패 기록');
  }

  // ③ 필드가 이미 있으면 LLM 호출 0 (상시 안전망이지만 평소 비용 0)
  console.log('③ name 이미 존재 → LLM 호출 안 함');
  {
    const raw = baseRaw({ name: '원래상품명' });
    const healer = new SelfHealer(mockClient({ name: 'X' }, /*throwOnCall*/ true), { fields: ['name'] });
    const r = await healer.heal(raw);
    ok(raw.name === '원래상품명', 'raw.name 그대로');
    ok(r.recovered.length === 0 && r.failed.length === 0, '복구 시도 자체가 없음(early return)');
  }

  // ④ fault injection: 결정적값을 일부러 제거 → 복구 + 원본일치 비교
  console.log('④ SELFHEAL_DEMO 주입: 결정적값 제거 후 복구·원본일치 확인');
  {
    const raw = baseRaw({ name: '케피 버블클렌저 3개' });
    const healer = new SelfHealer(mockClient({ name: '케피 버블클렌저 3개' }), {
      fields: ['name'],
      faultInject: ['name'],
    });
    const r = await healer.heal(raw);
    ok(r.injected.includes('name'), 'name 주입(제거)됨');
    ok(raw.name === '케피 버블클렌저 3개', '복구로 원래값 회복');
    ok(r.recovered[0]?.matchedInjected === true, '복구값 == 원본값(정확도 검증)');
  }

  // ⑤ 숫자 필드(consumer_price): null + 원본에 숫자 존재 → 복구
  console.log('⑤ consumerPrice=null + 원본에 숫자 존재 → 복구(number)');
  {
    const raw = baseRaw({ consumerPrice: null });
    const healer = new SelfHealer(mockClient({ consumerPrice: '18300' }), { fields: ['consumerPrice'] });
    const r = await healer.heal(raw);
    ok(raw.consumerPrice === 18300, `raw.consumerPrice 복구(number) (${raw.consumerPrice})`);
    ok(typeof raw.consumerPrice === 'number', 'number 타입으로 파싱됨');
    ok(r.recovered[0]?.field === 'consumerPrice', '리포트 기록');
  }

  // ⑥ 숫자 grounded 차단: 원본에 없는 숫자 → 채우지 않음
  console.log('⑥ LLM이 원본에 없는 숫자 반환 → grounded 차단');
  {
    const raw = baseRaw({ consumerPrice: null });
    const healer = new SelfHealer(mockClient({ consumerPrice: '99999' }), { fields: ['consumerPrice'] });
    const r = await healer.heal(raw);
    ok(raw.consumerPrice == null, 'raw.consumerPrice 여전히 null');
    ok(r.failed[0]?.reason.includes('grounded'), 'grounded 실패 기록');
  }

  // ⑦ 콤마·단위 정리("18,300원" → 18300) + grounded
  console.log('⑦ "18,300원" 파싱 정리 후 grounded 통과');
  {
    const raw = baseRaw({ consumerPrice: null });
    const healer = new SelfHealer(mockClient({ consumerPrice: '18,300원' }), { fields: ['consumerPrice'] });
    await healer.heal(raw);
    ok(raw.consumerPrice === 18300, `콤마·단위 제거 후 복구 (${raw.consumerPrice})`);
  }

  // ⑧ 숫자 sanity: 0 이하 거부
  console.log('⑧ 0 이하 숫자 거부(sanity)');
  {
    const raw = baseRaw({ consumerPrice: null });
    const healer = new SelfHealer(mockClient({ consumerPrice: '0' }), { fields: ['consumerPrice'] });
    const r = await healer.heal(raw);
    ok(raw.consumerPrice == null, '0 거부 → null 유지');
    ok(r.failed.length === 1, '실패 기록');
  }

  console.log(`\n결과: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
