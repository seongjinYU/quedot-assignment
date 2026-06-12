// 옵션 grounded·무손실 가드 검증 — mock LLM으로 오염/손실 출력을 주입해 가드가 폴백시키는지 확인(토큰 0).
//   ≤2축은 LLM 호출 자체가 없어야 하고(라우팅), 3축 LLM 출력은 가드를 통과해야만 채택된다.
import { OpenAiEnricher } from '../src/ai/openai.js';
import type { OptionNormalized } from '../src/ai/provider.js';

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => (c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.error(`  ✗ ${m}`)));

// 멀티축 LLM 응답(results)을 돌려주는 mock. throwOnCall=true면 "LLM 호출 0" 검증용.
const mockClient = (results: { option1: string | null; option2: string | null }[], throwOnCall = false): any => ({
  chat: {
    completions: {
      create: async () => {
        if (throwOnCall) throw new Error('LLM이 호출되면 안 되는데 호출됨(≤2축은 룰이어야)');
        return { choices: [{ message: { content: JSON.stringify({ results }) } }] };
      },
    },
  },
});

function makeEnricher(results: any[], throwOnCall = false): OpenAiEnricher {
  const e = new OpenAiEnricher('fake-key');
  (e as any).client = mockClient(results, throwOnCall);
  return e;
}

async function norm(e: OpenAiEnricher, names: string[]): Promise<OptionNormalized> {
  return (await e.normalizeOptions([{ names }], { productName: '키즈 제품' }))[0];
}

async function run() {
  // ① 오염: LLM이 입력에 없는 '유산균' 추가 → 가드가 위치 폴백
  console.log('① 3축 오염(외래 토큰) → grounded 가드가 위치 폴백');
  {
    const e = makeEnricher([{ option1: '유산균 딸기맛', option2: '120정/2개' }]);
    const r = await norm(e, ['딸기맛', '120정', '2개']);
    ok(r.option1 === '딸기맛', `폴백 option1='딸기맛' (실제 "${r.option1}")`);
    ok(r.option2 === '120정 / 2개', `폴백 option2='120정 / 2개' (실제 "${r.option2}")`);
    ok(r.aiPlaced === false, 'aiPlaced=false (오염→폴백, ai 아님)');
    ok(!`${r.option1} ${r.option2}`.includes('유산균'), '외래 토큰 "유산균" 제거됨');
  }

  // ② 클린 재배치: 입력 값만으로 종류를 option1로 교정 → 가드 통과(채택)
  console.log('② 3축 클린 재배치(입력값만) → 가드 통과, aiPlaced=true');
  {
    const e = makeEnricher([{ option1: '오렌지맛', option2: '2개입/대용량' }]);
    const r = await norm(e, ['2개입', '오렌지맛', '대용량']);
    ok(r.option1 === '오렌지맛', `LLM 재배치 채택 option1='오렌지맛' (실제 "${r.option1}")`);
    ok(r.aiPlaced === true, 'aiPlaced=true (grounded 통과)');
  }

  // ③ 손실: LLM이 '2개'를 누락 → 무손실 가드 위반 → 위치 폴백(누락 복원)
  console.log('③ 3축 값 누락 → 무손실 가드가 위치 폴백');
  {
    const e = makeEnricher([{ option1: '딸기맛', option2: '120정' }]); // 2개 빠짐
    const r = await norm(e, ['딸기맛', '120정', '2개']);
    ok(`${r.option1} ${r.option2}`.includes('2개'), '누락된 "2개"가 폴백으로 복원됨');
    ok(r.aiPlaced === false, 'aiPlaced=false (손실→폴백)');
  }

  // ④ ≤2축: LLM 호출 자체가 없어야 (라우팅) → mock이 throw해도 룰로 처리
  console.log('④ 2축 → LLM 호출 0(룰 라우팅)');
  {
    const e = makeEnricher([], /*throwOnCall*/ true);
    const r = await norm(e, ['핑크', '70호']);
    ok(r.option1 === '핑크' && r.option2 === '70호', `룰 위치값 (${r.option1}/${r.option2})`);
    ok(r.aiPlaced === false, 'aiPlaced=false (룰)');
  }

  console.log(`\n결과: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
