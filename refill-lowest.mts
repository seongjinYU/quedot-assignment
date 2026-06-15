// 일회성: 기존 산출물(output/<store>.json)의 lowest_price만 다시 채운다(재크롤·재OCR 없음).
//   lowestPrice.ts의 `if (naverClient && naverMid)` 게이트 버그 수정 후, mid 없는 몰(happyland 등)에
//   네이버 검색이 적용되는지 확인/반영하기 위한 용도. resolveLowestPrices가 행을 in-place로 채운다.
//   사용: tsx refill-lowest.mts output/happylandmall.json
import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'node:fs';
import { NaverShopClient, resolveLowestPrices } from './src/ai/lowestPrice.js';
import { EnuriClient } from './src/ai/enuri.js';
import { OpenAiMatchJudge } from './src/ai/productMatch.js';
import type { NormalizedProduct } from './src/normalize/schema.js';

const file = process.argv[2] ?? 'output/happylandmall.json';
const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as NormalizedProduct[];

const naverKey = process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET;
const shopClient = naverKey
  ? new NaverShopClient(process.env.NAVER_CLIENT_ID!, process.env.NAVER_CLIENT_SECRET!)
  : null;
const enuri = new EnuriClient();
const matchJudge = process.env.OPENAI_API_KEY ? new OpenAiMatchJudge(process.env.OPENAI_API_KEY) : undefined;

console.log(`refill ${file}: ${rows.length}행, naverKey=${!!naverKey}, enuri=ON, llm=${!!matchJudge}`);
try {
  const lp = await resolveLowestPrices(rows, shopClient, { enuri, rateLimitMs: 120, matchJudge });
  console.log(
    `💰 채움 ${lp.resolved}(네이버 ${lp.bySource.naver}/에누리 ${lp.bySource.enuri}/판매처 ${lp.bySource.store}) · 미발견 ${lp.nullCount}`,
  );
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`✓ 저장: ${file}`);
} finally {
  await enuri.close();
}
