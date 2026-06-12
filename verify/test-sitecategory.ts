// 카테고리 분류 검증 (실 LLM, 대량 샘플) — 자동수집된 사이트 nav + 실제 상품명으로 분류.
//   하드코딩 규칙 없이 "사이트 카테고리 + 상품"만으로 유아/기타·도메인이 맞는지 본다.
import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'node:fs';
import { OpenAiEnricher } from '../src/ai/openai.js';

const e = new OpenAiEnricher(process.env.OPENAI_API_KEY!);

// 크롤러가 자동수집하는 실제 nav (probe로 확인된 값과 동일)
const SITE_CATS: Record<string, string[]> = {
  phytonutri: ['그로우랩(유아,키즈)', '스포츠(시즈노프)', '혈행,혈압,혈당,콜레스테롤', '관절,연골,뼈',
    '갱년기(남성,여성)', '피부,다이어트', '눈,간,위건강', '여성배뇨', '종합비타민,미네랄', '세트상품'],
  happylandmall: ['신생아 의류', '내의 / 홈웨어', '우주복 / 바디슈트', '수면조끼', '상하복 / 세트',
    '상의', '하의', '아우터 / 가디건', '원피스', '드레스 / 정장', '양말 / 언더웨어', '잡화'],
  kefii: ['버블클렌저', '목욕 슬라임', '바디워시', '플레이비누', '스킨케어', '목욕놀이'],
};

const ADULT = /혈행|혈류|혈압|혈당|콜레스|갱년|관절|연골|전립|중년|남자|여성\s*갱|다이어트|위건강|여성배뇨|호로파|석류추출.*갱년/;
const BABY = /키즈|베이비|이유식|유아|아이|어린이|아기|신생아|돌\b|baby|grow|그로우|올로메가/i;

function names(store: string, n: number): string[] {
  const j = JSON.parse(fs.readFileSync(`output/${store}.json`, 'utf8'));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of j) {
    if (!seen.has(r.meta.productNo) && r.data.name) {
      seen.add(r.meta.productNo);
      out.push(r.data.name);
    }
  }
  return out.slice(0, n);
}

async function classify(store: string, name: string): Promise<string[]> {
  const r = await e.enrich({ name, categoryPath: null, sellerTags: [], detailText: null, siteCategories: SITE_CATS[store] });
  return r.category_group;
}

async function runStore(store: string, sample: number, expectAudience?: '유아' | '기타' | 'auto') {
  console.log(`\n${'═'.repeat(64)}\n■ ${store} (${sample}개)`);
  const list = names(store, sample);
  let auOk = 0,
    auTot = 0;
  for (const name of list) {
    const cats = await classify(store, name);
    const cat = cats[0] ?? '(없음)';
    // 유아/기타 기대치
    let exp: '유아' | '기타' | null = null;
    if (expectAudience === 'auto') exp = ADULT.test(name) ? '기타' : BABY.test(name) ? '유아' : null;
    else if (expectAudience) exp = expectAudience;
    let mark = ' ';
    if (exp) {
      auTot++;
      const got = cat.startsWith('유아') ? '유아' : cat.startsWith('기타') ? '기타' : '?';
      if (got === exp) (auOk++, (mark = '✓'));
      else mark = '✗';
    }
    console.log(`  ${mark} ${cat.padEnd(13)}${exp ? `(${exp})` : '     '} | ${name.slice(0, 44)}`);
  }
  if (auTot) console.log(`  → 유아/기타 정확도 ${auOk}/${auTot}`);
  return { auOk, auTot };
}

async function main() {
  const r1 = await runStore('phytonutri', 18, 'auto'); // 혼합몰: 성인/유아 자동 기대
  const r2 = await runStore('happylandmall', 14, '유아'); // 유아 의류몰: 전부 유아
  const r3 = await runStore('kefii', 12, '유아'); // 유아 목욕몰: 전부 유아
  const ok = r1.auOk + r2.auOk + r3.auOk;
  const tot = r1.auTot + r2.auTot + r3.auTot;
  console.log(`\n${'═'.repeat(64)}\n총 유아/기타 정확도 ${ok}/${tot} (${((ok / tot) * 100).toFixed(0)}%)`);
}
main().catch((err) => {
  console.error('검증 실패:', err);
  process.exit(1);
});
