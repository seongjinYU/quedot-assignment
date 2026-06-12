// lowest_price(가산점): "동일 상품"의 시장 최저가를 실조회한다. 두 소스를 합쳐 더 낮은 값:
//   ① 네이버 쇼핑검색 OpenAPI — syncNvMid(productId) 정확매칭, 빠름(API). 단 쿠팡 미포함.
//   ② 에누리(가격비교) — 쿠팡 포함 오픈마켓(11번가·G마켓·옥션·롯데·SSG), 브라우저 렌더.
// 오탐 방지가 생명: 느슨하게 매칭해 틀린 최저가를 채우느니 차라리 null + 사유.
//   가격 sanity(0.3~3배)는 mid일치에도 적용 — 같은 catalog라도 세트 vs 개당 단위가 다르면 제외.
// 쿠팡 직접크롤(Akamai)·파트너스 API(키 요건)는 막혀, 에누리를 합법적 우회로로 사용 — REFLECTION 참조.
import type { NormalizedProduct } from '../normalize/schema.js';
import type { EnuriClient } from './enuri.js';
import type { MatchJudge } from './productMatch.js';

export interface NaverShopItem {
  productId: string;
  title: string;
  lprice: number;
  mallName: string;
  brand: string;
  maker: string;
  link: string;
  productType: string;
}

const stripTags = (s: string) => (s || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ');
const round1 = (n: number) => Math.round(n * 10) / 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NaverShopClient {
  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  async search(query: string, display = 10): Promise<NaverShopItem[]> {
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=${display}`;
    const r = await fetch(url, {
      headers: { 'X-Naver-Client-Id': this.clientId, 'X-Naver-Client-Secret': this.clientSecret },
    });
    if (!r.ok) throw new Error(`naver shop API ${r.status}: ${(await r.text()).slice(0, 100)}`);
    const d: any = await r.json();
    return (d.items || []).map((it: any) => ({
      productId: String(it.productId ?? ''),
      title: stripTags(it.title ?? ''),
      lprice: Number(it.lprice) || 0,
      mallName: it.mallName ?? '',
      brand: it.brand ?? '',
      maker: it.maker ?? '',
      link: it.link ?? '',
      productType: String(it.productType ?? ''),
    }));
  }
}

const STOP = new Set(['세트', '정품', '공식', '본사', '무료배송', '사은품', '증정', 'set']);

function tokens(name: string): Set<string> {
  const s = stripTags(name).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[+/·,]/g, ' ');
  return new Set(
    s.split(/\s+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOP.has(t)),
  );
}

/**
 * 수량/용량 토큰 — 변종(6종 vs 7종, 3개 vs 11개) 구분용. 단 "종/개/세트/입/팩"은 같은 수량 의미라
 * 'ea'로 정규화해 동의어 매칭("3개"=="3종"). 용량(ml/g)은 그대로. → 6ea≠7ea로 오탐은 여전히 차단.
 */
function unitTokens(name: string): Set<string> {
  const m = stripTags(name).match(/\d+\s*(종|개|세트|ml|g|매|입|팩|구|병|포|p)/gi) || [];
  const out = new Set<string>();
  for (const x of m) {
    const mm = x.replace(/\s+/g, '').toLowerCase().match(/^(\d+)(.+)$/);
    if (!mm) continue;
    const cat = /^(종|개|세트|입|팩|구|p)$/.test(mm[2]) ? 'ea' : mm[2];
    out.add(mm[1] + cat);
  }
  return out;
}

function intersect(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** 묶음 수량(N+M) — "1+1"=2, "2+1"=3, 없으면 1. 단품 vs 묶음 오탐(예: 1+1 25,300 ↔ 단품 12,900) 차단용. */
function bundleQty(name: string): number {
  const m = stripTags(name).replace(/\s/g, '').match(/(\d+)\+(\d+)/);
  if (!m) return 1;
  const sum = parseInt(m[1], 10) + parseInt(m[2], 10);
  return sum >= 2 ? sum : 1;
}

/** 모델코드(영문1~3+숫자4+, 예 H1321210·A131300) — 몰 무관 동일상품 식별 강신호. 용량(1000ml)·짧은 숫자 회피. */
function modelCodes(name: string): Set<string> {
  const out = new Set<string>();
  for (const x of stripTags(name).toUpperCase().match(/[A-Z]{1,3}\d{4,}/g) || []) out.add(x);
  return out;
}
/** 우리 상품명과 후보명이 같은 모델코드를 공유하면 동일상품 확정(결정적 — LLM 불필요). */
export function shareModelCode(a: string, b: string): boolean {
  const ca = modelCodes(a);
  if (ca.size === 0) return false;
  const cb = modelCodes(b);
  for (const c of ca) if (cb.has(c)) return true;
  return false;
}

export interface Target {
  naverMid: string | null;
  name: string;
  brand: string | null;
  salePrice: number | null;
}

/** 검색결과 item이 우리 상품과 "동일"한지 — 오탐 방지 가드. */
export function judge(item: NaverShopItem, t: Target): { ok: boolean; reason: string } {
  const midMatch = !!(t.naverMid && item.productId === String(t.naverMid));

  // 가격 sanity (우리 판매가의 0.3~3배) — mid일치여도 단위 다르면(세트 vs 개당) 제외
  if (t.salePrice && t.salePrice > 0) {
    const ratio = item.lprice / t.salePrice;
    if (ratio < 0.3 || ratio > 3) return { ok: false, reason: `가격 이상(${round1(ratio)}배)${midMatch ? '·mid일치나 단위상이' : ''}` };
  }
  // ① syncNvMid 정확 일치 → 동일 상품 확정 (가격 통과 후)
  if (midMatch) return { ok: true, reason: `pid==mid(${item.productId})` };

  // ② 브랜드 일치 (한쪽이라도 비면 통과)
  const ib = (item.brand || item.maker || '').replace(/\s/g, '');
  const tb = (t.brand || '').replace(/\s/g, '');
  if (tb && ib && !ib.includes(tb) && !tb.includes(ib)) return { ok: false, reason: '브랜드 불일치' };

  // ③ 핵심 토큰 2개+ 공유
  const share = intersect(tokens(item.title), tokens(t.name));
  if (share < 2) return { ok: false, reason: `토큰 공유 ${share}<2` };

  // ④ 수량/용량 단위 일치 (6종≠7종, 3개≠11개 차단)
  const tu = unitTokens(t.name);
  if (tu.size > 0) {
    const iu = unitTokens(item.title);
    for (const u of tu) if (!iu.has(u)) return { ok: false, reason: `수량/용량 불일치(${u} 없음)` };
  }
  // ⑤ 묶음(N+M) 수량 일치 — 1+1(2개) vs 단품(1개) 오탐 차단 (12,900 ≈ 25,300÷2 같은 절반가 매칭 방지)
  const tBundle = bundleQty(t.name), iBundle = bundleQty(item.title);
  if (tBundle !== iBundle) return { ok: false, reason: `묶음수량 불일치(${tBundle}≠${iBundle})` };
  // 여기까지는 '결정적 사전필터'. 변종(여행용·샘플·단품 등) 의미 판정은 비-mid 후보에 한해 LLM이 최종 검수.
  return { ok: true, reason: `brand+토큰${share}+단위+묶음+가격` };
}

export function buildQuery(name: string, short = false): string {
  const clean = stripTags(name)
    .replace(/\[[^\]]*\]/g, ' ') // [태그] 제거
    .replace(/[가-힣a-z]+(?:\s*\+\s*[가-힣a-z]+){1,}/gi, ' ') // 색상/구성 나열(핑크+옐로우+퍼플) 제거
    .replace(/\s+/g, ' ')
    .trim();
  if (!short) return clean.slice(0, 40); // 네이버: 긴 query로 pid==mid 매칭 잘됨
  return clean.split(' ').slice(0, 3).join(' '); // 에누리: 브랜드+상품+수량 핵심만(긴 query는 0건)
}

export interface LowestPriceReport {
  attempted: number; // 조회 시도한 상품(productNo) 수
  resolved: number; // 최저가 채운 수
  nullCount: number; // 못 채운 수
  bySource: { naver: number; enuri: number; store: number }; // 채워진 값의 소스별 (store=판매처가 타몰보다 쌈)
}

interface Candidate {
  price: number;
  source: '네이버쇼핑' | '에누리';
  mall: string;
  reason: string;
  name: string; // 후보 상품명 — LLM 동일상품 판정용
  strong: boolean; // true=pid==mid 정확매칭(LLM 불필요) / false=휴리스틱(LLM 검수 대상)
}

/** 간단 동시성 풀 — items를 워커 concurrency개로 나눠 동시 처리(에누리 page 풀 크기와 맞춤). 단일 워커 실패는 격리. */
async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
}

/**
 * 전 상품(rows)의 lowest_price를 채운다(in-place). productNo 단위로 1회 조회해 같은 상품 SKU에 동일 적용.
 * 네이버(API, mid매칭) + 에누리(브라우저, 쿠팡 포함) 후보 중 가장 낮은 값을 채운다.
 */
export async function resolveLowestPrices(
  rows: NormalizedProduct[],
  naverClient: NaverShopClient | null,
  opts: { enuri?: EnuriClient; rateLimitMs?: number; matchJudge?: MatchJudge } = {},
): Promise<LowestPriceReport> {
  const byProduct = new Map<string, NormalizedProduct[]>();
  for (const r of rows) {
    const arr = byProduct.get(r.meta.productNo);
    if (arr) arr.push(r);
    else byProduct.set(r.meta.productNo, [r]);
  }

  const report: LowestPriceReport = { attempted: 0, resolved: 0, nullCount: 0, bySource: { naver: 0, enuri: 0, store: 0 } };
  const groups = [...byProduct.values()];
  const concurrency = opts.enuri ? 4 : 8; // 에누리 page 풀(4)에 맞춤 / 네이버만이면 API 병렬

  await runPool(groups, concurrency, async (skus) => {
    const rep = skus[0];
    const naverMid = rep.meta.naverMid != null ? String(rep.meta.naverMid) : null;
    const target: Target = { naverMid, name: rep.data.name ?? '', brand: rep.data.brand_name, salePrice: rep.data.sales_price };
    const query = buildQuery(target.name);
    const fetchedAt = new Date().toISOString();
    const candidates: Candidate[] = [];
    report.attempted++;

    // ① 네이버 (naverMid 정확매칭 활용 — 키 있고 매칭키 있을 때)
    if (naverClient && naverMid) {
      try {
        // 긴 쿼리로 1차(display 넉넉히 40 — 정확매칭이 상위 10위 밖이어도 회수). pid==mid를 못 찾으면
        // 짧은 쿼리로 한 번 더 검색해 합친다(검색결과가 달라 정확매칭이 잡힐 수 있음). judge는 그대로라 오탐 위험 0.
        const items = await naverClient.search(query, 40);
        const hasMid = () => items.some((it) => it.productId === String(naverMid));
        if (!hasMid()) {
          const more = await naverClient.search(buildQuery(target.name, true), 40);
          const seen = new Set(items.map((i) => i.productId));
          for (const m of more) if (!seen.has(m.productId)) items.push(m);
        }
        for (const it of items) {
          const j = judge(it, target);
          if (j.ok && it.lprice > 0) {
            // 확정(LLM 불필요): pid==mid 정확매칭 OR 모델코드 일치
            const strong = !!(naverMid && it.productId === String(naverMid)) || shareModelCode(target.name, it.title);
            candidates.push({ price: it.lprice, source: '네이버쇼핑', mall: it.mallName, reason: `pid:${it.productId}·${j.reason}`, name: it.title, strong });
          }
        }
      } catch { /* 격리 */ }
      if (opts.rateLimitMs) await sleep(opts.rateLimitMs);
    }

    // ② 에누리 (매칭키 불필요 — 고도몰 상품도 가능, 쿠팡 포함). 짧은 query 사용(긴 query는 0건)
    if (opts.enuri) {
      try {
        const eitems = await opts.enuri.search(buildQuery(target.name, true));
        for (const e of eitems) {
          if (e.coupon) continue; // ③ 쿠폰가는 조건부(클립·기간한정)라 신뢰도 낮음 → 비쿠폰 표시가만 사용
          const asItem: NaverShopItem = { productId: '', title: e.name, lprice: e.price, mallName: e.mall, brand: '', maker: '', link: '', productType: '' };
          const j = judge(asItem, target);
          // 에누리는 mid 없음 → 모델코드 일치 시 strong(확정, LLM 생략), 아니면 weak(LLM 검수)
          if (j.ok && e.price > 0) candidates.push({ price: e.price, source: '에누리', mall: e.mall || '오픈마켓', reason: j.reason, name: e.name, strong: shareModelCode(target.name, e.name) });
        }
      } catch { /* 격리 */ }
    }

    // 동일상품 LLM 검수 — 결정적 사전필터(②③④⑤)를 통과한 '약한'(비-mid) 후보만 의미 판정.
    //   mid 정확매칭(strong)은 확정이라 LLM 생략. 확신 통과 후보가 없으면 null(오탐 방지).
    let finalCands = candidates;
    const weak = candidates.filter((c) => !c.strong);
    if (weak.length > 0) {
      if (opts.matchJudge) {
        let okIdx: number[] = [];
        try {
          okIdx = await opts.matchJudge.sameProduct(
            { name: target.name, salePrice: target.salePrice },
            weak.map((c) => ({ name: c.name, price: c.price })),
          );
        } catch { /* LLM 실패 → 약한 후보 전부 제외(보수적) */ }
        const ok = new Set(okIdx);
        finalCands = [...candidates.filter((c) => c.strong), ...weak.filter((_, i) => ok.has(i))];
      } else {
        // LLM 미주입 → 약한 후보는 검수 불가라 보수적으로 제외(오탐 방지). mid 확정만 사용.
        finalCands = candidates.filter((c) => c.strong);
      }
    }

    if (finalCands.length === 0) {
      apply(skus, null, { method: 'empty', reason: naverMid ? '동일상품 미확정(mid 불일치·LLM 검수 통과 후보 없음·오탐 방지)' : '동일상품 미확정(LLM 검수 통과 후보 없음·오탐 방지)' });
      report.nullCount += skus.length;
      return;
    }

    // ④ 시장 최저(검수 통과) 후보 vs 판매가 — 실제로 더 낮은 값(=사실)을 채운다.
    const marketBest = finalCands.reduce((a, b) => (b.price < a.price ? b : a));
    // 채움 경로 정직 표기: mid 정확매칭 / 모델코드 확정 / LLM 검수
    const llmTag = marketBest.reason.includes('pid==mid') ? '' : marketBest.strong ? '·모델코드확정' : '·LLM확인';
    const sp = target.salePrice;
    if (sp != null && sp > 0 && sp < marketBest.price) {
      // 판매처(브랜드스토어)가 시장 최저 — 더 낮은 판매가가 실제 최저가. 타몰 최저도 함께 기록(투명).
      apply(skus, sp, {
        method: 'crawled',
        source: `판매처(브랜드스토어) 최저 · 타몰 최저 ${marketBest.price.toLocaleString()}원(${marketBest.source}·${marketBest.mall}${llmTag})`,
        fetchedAt,
      });
      report.resolved += skus.length;
      report.bySource.store++;
    } else {
      apply(skus, marketBest.price, {
        method: 'crawled',
        source: `${marketBest.source} · ${marketBest.mall} · ${marketBest.reason}${llmTag}`,
        fetchedAt,
      });
      report.resolved += skus.length;
      if (marketBest.source === '네이버쇼핑') report.bySource.naver++;
      else report.bySource.enuri++;
    }
  });
  return report;
}

function apply(skus: NormalizedProduct[], price: number | null, prov: NormalizedProduct['provenance']['lowest_price']) {
  for (const s of skus) {
    s.data.lowest_price = price;
    s.provenance.lowest_price = prov;
  }
}
