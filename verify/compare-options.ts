// 옵션 의미배치 "밥값 검증" — 룰(위치 기반) vs 실제 LLM 의미배치를 다축 케이스에서 비교.
//   질문: LLM 의미배치가 위치 기반 룰 대비 실제로 다른 결과를 내는가? 낸다면 어떤 케이스에서?
//   결론: 차이가 "역순(네이버 축 순서가 종류/구성과 어긋남)"에만 몰리면, LLM은 그 교정값만큼만 밥값.
//   사용: npm run compare:options   (OPENAI_API_KEY 있으면 실 LLM, 없으면 룰만 출력)
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { RuleEnricher } from '../src/ai/rule.js';
import { OpenAiEnricher } from '../src/ai/openai.js';
import type { OptionNormalized } from '../src/ai/provider.js';

interface Case {
  label: string;
  productName: string;
  names: string[];
  natural: string; // 사람이 기대하는 올바른 option1 (의미상 "종류")
}

// 다축 케이스만 (단일 축은 이미 룰=결정적). 네이버 축 순서가 자연/역순인 경우를 섞음.
const cases: Case[] = [
  { label: '자연순서 (종류→구성)', productName: '키즈 멀티비타민', names: ['딸기맛', '120정'], natural: '딸기맛' },
  { label: '역순 (구성→종류)', productName: '키즈 멀티비타민', names: ['120정', '딸기맛'], natural: '딸기맛' },
  { label: '색상→사이즈 (자연)', productName: '신생아 우주복', names: ['핑크', '70호'], natural: '핑크' },
  { label: '사이즈→색상 (역순)', productName: '신생아 우주복', names: ['70호', '핑크'], natural: '핑크' },
  { label: '수식어/이모지', productName: '키즈 비타민', names: ['★특가★ 딸기맛', '[필수] 120정 ✨'], natural: '딸기맛' },
  { label: '3축 (종류·용량·수량)', productName: '키즈 유산균', names: ['딸기맛', '120정', '2개'], natural: '딸기맛' },
  { label: '3축 역순 (수량·종류·용량)', productName: '키즈 유산균', names: ['2개입', '오렌지맛', '대용량'], natural: '오렌지맛' },
];

const fmt = (o: OptionNormalized) => `option1="${o.option1 ?? ''}" | option2="${o.option2 ?? ''}"`;

async function main() {
  const rule = new RuleEnricher();
  const key = process.env.OPENAI_API_KEY;
  const llm = key ? new OpenAiEnricher(key) : null;
  console.log(`═══ 옵션 의미배치 비교: 룰(위치) vs LLM ═══`);
  console.log(`LLM: ${llm ? 'ON (gpt-4o-mini 실호출)' : 'OFF (OPENAI_API_KEY 없음 → 룰만 표시)'}\n`);

  let diffCount = 0;
  let llmCorrectInverted = 0; // LLM이 역순을 자연순으로 교정한 횟수
  let invertedTotal = 0;
  let allMatchRule = true;

  for (const c of cases) {
    const isInverted = c.names[0] !== c.natural && c.names.includes(c.natural);
    if (isInverted) invertedTotal++;

    const r = (await rule.normalizeOptions([{ names: c.names }]))[0];
    const l = llm ? (await llm.normalizeOptions([{ names: c.names }], { productName: c.productName }))[0] : null;

    const diff = l ? r.option1 !== l.option1 || r.option2 !== l.option2 : false;
    if (l && (r.option1 !== l.option1 || r.option2 !== l.option2)) allMatchRule = false;
    if (diff) diffCount++;
    // LLM이 option1을 "자연(종류)"로 맞췄는지
    if (l && isInverted && l.option1 === c.natural) llmCorrectInverted++;

    console.log(`▼ ${c.label}  ${isInverted ? '⟲역순' : ''}`);
    console.log(`   입력 names: [${c.names.join(', ')}]  (기대 종류="${c.natural}")`);
    console.log(`   룰(위치):  ${fmt(r)}`);
    if (l) console.log(`   LLM:       ${fmt(l)}   ${diff ? '← 차이' : '= 동일'}`);
    console.log('');
  }

  console.log('─'.repeat(60));
  if (!llm) {
    console.log('LLM OFF — 룰 출력만. 실 LLM 비교는 OPENAI_API_KEY 설정 후 재실행.');
    return;
  }
  console.log(`결과: 전체 ${cases.length}건 중 룰≠LLM 차이 ${diffCount}건`);
  console.log(`  · 역순 케이스 ${invertedTotal}건 중 LLM이 종류를 option1로 교정 ${llmCorrectInverted}건`);
  if (allMatchRule) {
    console.log('  ⚠️ 모든 케이스가 룰과 동일 — 역순도 교정 안 됨. LLM이 fallback했거나(키 무효?) 의미배치 가치 미미.');
  } else if (diffCount > 0 && llmCorrectInverted === invertedTotal && diffCount === invertedTotal) {
    console.log('  → 차이는 "역순 케이스 교정"에만 집중. 즉 LLM의 밥값 = 네이버 축 순서가 뒤집힌 경우의 교정뿐.');
    console.log('    판단: 실제 네이버 데이터에 역순이 흔하면 유지, 드물면 위치 룰로 강등(더 싸고 결정적).');
  } else {
    console.log('  → 차이가 역순 외에도 분포. 의미배치가 여러 패턴에 관여 — 유지 근거 있음(상세는 위 표 확인).');
  }
}
main().catch((e) => {
  console.error('비교 실패:', e);
  process.exit(1);
});
