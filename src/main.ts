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
import { SelfHealer } from './ai/selfHeal.js';
import { mapToQuedot } from './normalize/mapper.js';
import { validate, type ValidationIssue } from './normalize/validate.js';
import { resolveBundlePricing } from './normalize/bundle.js';
import { NaverShopClient, resolveLowestPrices } from './ai/lowestPrice.js';
import { EnuriClient } from './ai/enuri.js';
import { OpenAiMatchJudge } from './ai/productMatch.js';
import { buildQualityReport, printQualityReport } from './normalize/quality.js';
import {
  loadJson,
  groupByProduct,
  planIncremental,
  buildCache,
  type CrawlCache,
  type IncrementalPlan,
} from './normalize/incremental.js';
import type { StoreAdapter, RawProduct } from './adapters/types.js';
import type { NormalizedProduct } from './normalize/schema.js';
import type { Enricher } from './ai/provider.js';

const storeUrl = process.argv[2] ?? 'https://smartstore.naver.com/phytonutri';
const limit = Number(process.argv[3] ?? '1');
// OCR 보강(조건부): `npm run crawl <url> <limit> ocr` 또는 ENABLE_OCR=true 일 때만
const ocrRequested = process.argv[4] === 'ocr' || process.env.ENABLE_OCR === 'true';
// 증분 재크롤: `npm run crawl <url> <limit> incremental` 또는 INCREMENTAL=true — 신규/가격변경만 재크롤
const incremental = process.argv.includes('incremental') || process.env.INCREMENTAL === 'true';

async function main() {
  const session = new BrowserSession({ headless: false, rateLimitMs: 1500 });
  // OpenAI 키 있으면 LLM, 없으면 룰 baseline (자동 강등)
  const enricher: Enricher = process.env.OPENAI_API_KEY
    ? new OpenAiEnricher(process.env.OPENAI_API_KEY)
    : new RuleEnricher();
  console.log(`Enricher: ${enricher.kind}`);
  // 공유 OpenAI 클라이언트 (OCR · 자가복구가 함께 사용)
  const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  // OCR 보강기: 근거 부족(셀러태그·본문 없음) 상품의 상세 이미지에서 텍스트 추출
  const ocr = ocrRequested && openaiClient ? new OcrReader(openaiClient) : null;
  if (ocrRequested && !ocr) console.log('⚠️ OCR 요청됐으나 OPENAI_API_KEY 없음 → OCR 비활성');
  console.log(`OCR: ${ocr ? 'ON (근거 부족 상품의 상세이미지 보강)' : 'OFF'}`);
  // 자가복구: 결정적 추출이 핵심 필드를 비웠을 때 원본을 LLM에 넘겨 복구(상시 안전망 — 평소 호출 0).
  //   SELFHEAL_DEMO=name 으로 결정적값을 일부러 제거해 복구 경로를 재현(시연/검증용).
  const selfHealDemo = (process.env.SELFHEAL_DEMO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const selfHealer = openaiClient
    ? new SelfHealer(openaiClient, { fields: ['name', 'consumerPrice'], faultInject: selfHealDemo })
    : null;
  console.log(
    `자가복구: ${selfHealer ? 'ON (결정적 추출 실패 시 원본 LLM 복구)' + (selfHealDemo.length ? ` · 데모주입 [${selfHealDemo.join(',')}]` : '') : 'OFF (OPENAI_API_KEY 없음)'}`,
  );
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

    // 출력 경로 — 증분 diff(이전 결과/캐시 로드)를 위해 미리 산출
    const outDir = path.resolve('output');
    fs.mkdirSync(outDir, { recursive: true });
    const storeName =
      storeUrl.match(/naver\.com\/([^/?#]+)/)?.[1] ??
      new URL(storeUrl).hostname.replace(/^m\./, '').split('.')[0]; // happylandmall 등
    const outPath = path.join(outDir, `${storeName}.json`);
    const cachePath = path.join(outDir, `${storeName}.cache.json`);

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

    // 증분 재크롤: 이전 결과/캐시와 배치가격을 diff → 신규/가격변경 상품만 무거운 재크롤.
    //   (최초 1회나 이전 산출물 없으면 전수 크롤로 자동 폴백)
    let freshIds = ids;
    let prevByProduct = new Map<string, NormalizedProduct[]>();
    let incPlan: IncrementalPlan | null = null;
    if (incremental) {
      const prevRows = loadJson<NormalizedProduct[]>(outPath);
      const prevCache = loadJson<CrawlCache>(cachePath);
      if (prevRows?.length && prevCache) {
        prevByProduct = groupByProduct(prevRows);
        incPlan = planIncremental(ids, prices, prevCache, prevByProduct);
        freshIds = incPlan.fresh;
        const changed = Object.values(incPlan.reasons).filter((r) => r === 'price-changed').length;
        const added = incPlan.fresh.length - changed;
        console.log(
          `♻️ 증분: 전체 ${ids.length} → 재크롤 ${freshIds.length}(신규 ${added}/가격변경 ${changed}) · 재사용 ${incPlan.reuse.length}`,
        );
      } else {
        console.log('♻️ 증분 요청됐으나 이전 결과/캐시 없음 → 전수 크롤(최초 1회)');
      }
    }

    // 1-pass: 전 상품 수집(fetch + 가격병합 + OCR + 자가복구). 매핑은 사이트 성격 파악 후로 미룬다.
    const raws: RawProduct[] = [];
    const failures: { productNo: string; reason: string }[] = [];
    for (const id of freshIds) {
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
        // 자가복구: 결정적 추출이 핵심 필드(name 등)를 비웠으면 원본을 LLM에 넘겨 복구.
        if (selfHealer) {
          const hr = await selfHealer.heal(raw);
          if (hr.injected.length) console.log(`  🔧 자가복구[데모]: 결정적값 제거 [${hr.injected.join(', ')}] (${id})`);
          for (const r of hr.recovered)
            console.log(
              `  🔧 자가복구: ${r.field} = "${String(r.value).slice(0, 30)}" 복구 (conf ${r.confidence}${r.matchedInjected != null ? `, 원본일치 ${r.matchedInjected}` : ''})`,
            );
          for (const f of hr.failed) console.log(`  🔧 자가복구 실패: ${f.field} — ${f.reason}`);
        }
        raws.push(raw);
      } catch (e: any) {
        // 에러 격리: 한 상품 실패해도 전체 중단 없이 다음으로 (실패 목록은 품질 리포트에 기록)
        failures.push({ productNo: String(id), reason: e?.message ?? String(e) });
        console.error(`  ✗ ${id} 실패: ${e.message}`);
      }
    }

    // 1.5-pass: 스토어 카테고리 수집 — "이 스토어가 취급하는 것"을 AI 분류 컨텍스트로.
    //   어댑터의 전시 카테고리(nav: 네이버 그로우랩/혈행, 고도몰 신생아의류 등)를 우선 — 사이트 성격을 잘 드러냄.
    //   없으면 상품들의 distinct 표준 카테고리로 폴백. (하드코딩 키워드 없이 사이트 실제 카테고리로 분기)
    const navCats = adapter.listCategories ? await adapter.listCategories(storeUrl) : [];
    const siteCategories = navCats.length
      ? navCats
      : [...new Set(raws.map((r) => r.categoryPath ?? '').filter(Boolean))];
    if (siteCategories.length)
      console.log(
        `\n🏷️ 스토어 카테고리(${navCats.length ? 'nav' : '표준'} ${siteCategories.length}): ${siteCategories.slice(0, 24).join(' | ')}`,
      );

    // 2-pass: 정규화(매핑) — 스토어 카테고리를 함께 줘 유아/기타·도메인 분류. (묶음 보정은 다음 pass)
    const rawRows: NormalizedProduct[] = [];
    for (const raw of raws) {
      try {
        const nps = await mapToQuedot(raw, storeUrl, enricher, { siteCategories });
        console.log(`\n──────── 상품 ${raw.productNo} (옵션 ${nps.length}건) ────────`);
        for (const np of nps) {
          rawRows.push(np);
          const opt = [np.data.option1, np.data.option2].filter(Boolean).join(' / ') || '(옵션없음)';
          console.log(
            `  • ${opt} | 정가 ${np.data.consumer_price} → 판매 ${np.data.sales_price} (${np.data.discount_rate}%) | ${(np.data.category_group ?? []).join(',')}`,
          );
        }
      } catch (e: any) {
        failures.push({ productNo: raw.productNo, reason: e?.message ?? String(e) });
        console.error(`  ✗ ${raw.productNo} 매핑 실패: ${e.message}`);
      }
    }

    // 2-pass: 묶음(골라담기/N+M) 가격 보정 — 낱개 상품 매칭 + 숫자 교차검증으로 할인 복원
    const bundleReport = resolveBundlePricing(rawRows);
    if (bundleReport.bundles > 0) {
      console.log(`\n🔗 묶음 보정: ${bundleReport.bundles}개 중 매칭 ${bundleReport.matched} / 폴백 ${bundleReport.fallback}`);
      for (const d of bundleReport.details) {
        console.log(
          d.result === 'matched'
            ? `   ✓ ${d.productNo} ${(d.name ?? '').slice(0, 28)} → 낱개 ${d.ref} 기준 할인 ${d.discount}%`
            : `   · ${d.productNo} ${(d.name ?? '').slice(0, 28)} → 개당 통일(낱개 매칭 실패)`,
        );
      }
    }

    // 2.5-pass: lowest_price 실조회 (가산점) — 네이버 API(syncNvMid 정확매칭) + 에누리(쿠팡 포함, opt-in).
    //   오탐가드(브랜드·토큰·수량단위·가격 sanity) 통과만 채움, 실패는 null+사유. 두 소스 중 더 낮은 값.
    //   쿠팡 직접크롤·파트너스API는 막혀(REFLECTION) 에누리 가격비교로 우회 — 쿠팡 등 오픈마켓가 확보.
    const naverKey = process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET;
    const enuriEnabled = process.argv.includes('enuri') || process.env.ENABLE_ENURI === 'true';
    if (naverKey || enuriEnabled) {
      const shopClient = naverKey ? new NaverShopClient(process.env.NAVER_CLIENT_ID!, process.env.NAVER_CLIENT_SECRET!) : null;
      const enuriClient = enuriEnabled ? new EnuriClient() : undefined;
      // 비-mid(휴리스틱) 후보의 동일상품 최종 판정 = LLM. 키 없으면 약한 후보는 보수적으로 제외(오탐 방지).
      const matchJudge = process.env.OPENAI_API_KEY ? new OpenAiMatchJudge(process.env.OPENAI_API_KEY) : undefined;
      if (enuriEnabled && !matchJudge) console.log('  ⚠️ OPENAI_API_KEY 없음 → 에누리/비-mid 후보는 LLM 검수 불가로 제외(공란↑)');
      try {
        const lp = await resolveLowestPrices(rawRows, shopClient, { enuri: enuriClient, rateLimitMs: 120, matchJudge });
        console.log(
          `\n💰 최저가 실조회: ${lp.attempted}상품 → 채움 ${lp.resolved}(네이버 ${lp.bySource.naver}/에누리 ${lp.bySource.enuri}/판매처 ${lp.bySource.store}) · 미발견 ${lp.nullCount}`,
        );
      } finally {
        await enuriClient?.close();
      }
    } else {
      console.log('\n💰 최저가: NAVER 키 없음 + 에누리 미활성 → lowest_price 공란 유지');
    }

    // 3-pass: 검증(단일 관문) — 묶음 보정이 반영된 최종 산출물(SKU 단위)에 적용.
    //   큐닷 제안서는 옵션 조합(SKU) 단위다: option1/2가 단일값이고 가격이 1:1로 붙어,
    //   옵션마다 가격·품절이 달라(한 상품 안에서도) SKU별로 펼쳐 정확도를 보존한다.
    //   '상품 수'(productNo)와 'SKU 수'는 품질 리포트에 병기(totalProducts/totalRows).
    // 증분: 재사용(이전 결과) + 신규/변경(이번 크롤)을 목록 순서로 병합. 전수면 rawRows 그대로.
    let results: NormalizedProduct[];
    if (incremental && incPlan) {
      const freshByProduct = groupByProduct(rawRows);
      results = [];
      for (const id of ids) {
        const rows = freshByProduct.get(String(id)) ?? prevByProduct.get(String(id));
        if (rows) results.push(...rows);
      }
    } else {
      results = rawRows;
    }
    const allIssues: ValidationIssue[][] = results.map((np) => validate(np));

    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    const productCount = new Set(results.map((r) => r.meta.productNo)).size;
    console.log(
      `\n✓ 저장: ${outPath} (상품 ${productCount}건 / SKU ${results.length}건, 실패 ${failures.length}개)`,
    );
    // 다음 증분용 캐시 저장(가격 시그널) — 전수/증분 모두 갱신
    fs.writeFileSync(cachePath, JSON.stringify(buildCache(storeName, results), null, 2));

    // 정제 품질 리포트 (수치화) — 콘솔 + 파일
    const quality = buildQualityReport(storeName, results, allIssues, failures);
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
