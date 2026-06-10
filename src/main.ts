// 파이프라인 엔트리: URL → 크롤(어댑터) → 정규화 → AI enrich → 검증 → 출력
// 사용법: npm run crawl [storeUrl] [limit]
import dotenv from 'dotenv';
dotenv.config({ override: true }); // .env가 셸 환경변수보다 우선
import fs from 'node:fs';
import path from 'node:path';
import { BrowserSession } from './crawler/browser.js';
import { NaverStoreAdapter } from './adapters/naver.js';
import { GodomallAdapter } from './adapters/godomall.js';
import OpenAI from 'openai';
import { RuleEnricher } from './ai/rule.js';
import { OpenAiEnricher } from './ai/openai.js';
import { OcrReader } from './ai/ocr.js';
import { mapToQuedot } from './normalize/mapper.js';
import { validate, type ValidationIssue } from './normalize/validate.js';
import { buildQualityReport, printQualityReport } from './normalize/quality.js';
import type { StoreAdapter } from './adapters/types.js';
import type { Enricher } from './ai/provider.js';

const storeUrl = process.argv[2] ?? 'https://smartstore.naver.com/phytonutri';
const limit = Number(process.argv[3] ?? '1');
// OCR 보강(조건부): `npm run crawl <url> <limit> ocr` 또는 ENABLE_OCR=true 일 때만
const ocrRequested = process.argv[4] === 'ocr' || process.env.ENABLE_OCR === 'true';

async function main() {
  const session = new BrowserSession({ headless: false, rateLimitMs: 1500 });
  // OpenAI 키 있으면 LLM, 없으면 룰 baseline (자동 강등)
  const enricher: Enricher = process.env.OPENAI_API_KEY
    ? new OpenAiEnricher(process.env.OPENAI_API_KEY)
    : new RuleEnricher();
  console.log(`Enricher: ${enricher.kind}`);
  // OCR 보강기: 근거 부족(셀러태그·본문 없음) 상품의 상세 이미지에서 텍스트 추출
  const ocr =
    ocrRequested && process.env.OPENAI_API_KEY
      ? new OcrReader(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
      : null;
  if (ocrRequested && !ocr) console.log('⚠️ OCR 요청됐으나 OPENAI_API_KEY 없음 → OCR 비활성');
  console.log(`OCR: ${ocr ? 'ON (근거 부족 상품의 상세이미지 보강)' : 'OFF'}`);
  try {
    // ⚠️ 순서 중요: 네이버를 먼저 매칭. GodomallAdapter는 "비네이버 몰" 전반을 후보로 받아
    //    런타임에 고도몰 구조를 검증하는 fallback이므로 가장 마지막에 둔다.
    const adapters: StoreAdapter[] = [
      new NaverStoreAdapter(session),
      new GodomallAdapter({ fetchDetail: !!ocr }),
    ];
    const adapter = adapters.find((a) => a.matches(storeUrl));
    if (!adapter) throw new Error(`지원 어댑터 없음: ${storeUrl}`);
    console.log(`어댑터: ${adapter.name} | 대상: ${storeUrl} | limit: ${limit}`);

    // 브라우저가 필요한 어댑터만 세션 오픈 (happyland는 순수 HTTP → 스킵)
    if (adapter.needsBrowser !== false) {
      await session.open(storeUrl);
      if (/naver\.com/.test(storeUrl) && !(await session.isNaverLoggedIn())) {
        console.log('🔑 네이버 로그인 필요 — 브라우저 창에서 직접 로그인해주세요...');
        if (!(await session.waitForNaverLogin())) throw new Error('로그인 시간 초과');
        console.log('✓ 로그인 확인');
      }
    }

    const allIds = await adapter.listProductNos(storeUrl);
    const ids = limit > 0 ? allIds.slice(0, limit) : allIds;
    console.log(`목록 전수 ${allIds.length}개 → 상세 처리 ${ids.length}개`);

    // 가격은 배치로 한 번에 (개별 호출 회피 — CLAUDE.md 성능 규칙)
    const prices = adapter.fetchPrices ? await adapter.fetchPrices(storeUrl, ids) : new Map();
    if (adapter.fetchPrices) console.log(`가격 배치 조회: ${prices.size}/${ids.length}건`);

    const results = [];
    const allIssues: ValidationIssue[][] = [];
    let failCount = 0;
    for (const id of ids) {
      try {
        const raw = await adapter.fetchProduct(storeUrl, id);
        // 배치 가격 병합
        const pi = prices.get(String(id));
        if (pi) {
          if (pi.consumerPrice != null) raw.consumerPrice = pi.consumerPrice;
          if (pi.salePrice != null) raw.salePrice = pi.salePrice;
          if (pi.deliveryFee) raw.deliveryFee = pi.deliveryFee;
        }
        // 조건부 OCR: 근거 부족(셀러태그·본문텍스트 없음) + 상세이미지 있을 때만 보강
        const lowGrounding = !(raw.sellerTags?.length) && !(raw.detailText && raw.detailText.trim().length > 10);
        if (ocr && lowGrounding && raw.detailImages?.length) {
          const t = await ocr.extractText(raw.detailImages);
          if (t) {
            raw.detailText = t;
            raw.detailTextSource = 'ocr';
            console.log(`  🔤 OCR 보강: detailText ${t.length}자 (${id})`);
          }
        }
        const nps = await mapToQuedot(raw, storeUrl, enricher);
        console.log(`\n──────── 상품 ${id} (옵션 ${nps.length}건) ────────`);
        for (const np of nps) {
          const issues = validate(np);
          results.push(np);
          allIssues.push(issues);
          const opt = [np.data.option1, np.data.option2].filter(Boolean).join(' / ') || '(옵션없음)';
          console.log(`  • ${opt} | 정가 ${np.data.consumer_price} → 판매 ${np.data.sales_price} (${np.data.discount_rate}%)`);
          if (issues.length) console.log('    🔎', JSON.stringify(issues));
        }
      } catch (e: any) {
        // 에러 격리: 한 상품 실패해도 전체 중단 없이 다음으로
        failCount++;
        console.error(`  ✗ ${id} 실패: ${e.message}`);
      }
    }

    const outDir = path.resolve('output');
    fs.mkdirSync(outDir, { recursive: true });
    const storeName =
      storeUrl.match(/naver\.com\/([^/?#]+)/)?.[1] ??
      new URL(storeUrl).hostname.replace(/^m\./, '').split('.')[0]; // happylandmall 등
    const outPath = path.join(outDir, `${storeName}.json`);
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\n✓ 저장: ${outPath} (${results.length}건, 실패 ${failCount}개)`);

    // 정제 품질 리포트 (수치화) — 콘솔 + 파일
    const quality = buildQualityReport(storeName, results, allIssues);
    printQualityReport(quality);
    const qPath = path.join(outDir, `${storeName}.quality.json`);
    fs.writeFileSync(qPath, JSON.stringify(quality, null, 2));
    console.log(`\n✓ 품질 리포트: ${qPath}`);
  } finally {
    await session.close();
  }
}

main().catch((e) => {
  console.error('파이프라인 실패:', e);
  process.exit(1);
});
