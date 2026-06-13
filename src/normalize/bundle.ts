// 묶음(골라담기 / N+M / BUY N GET M) 상품 가격 정규화 — 2-pass 후처리.
//
// 문제: "[개당 가격]" 묶음 상품은 네이버가 정가 자리에 '개당가'(예 16,430)를, 판매 자리에
//   '전체 결제금액'(예 7개 115,010)을 줘서 단위가 어긋난다(판매>정가) → 할인율이 -600% 헛값.
//   묶음 listing 자체엔 정가(기준가)가 없어 그 상품만 봐선 진짜 할인을 알 수 없다.
//
// 해결(②a): 같은 store의 낱개 상품을 찾아(이름 후보 + 숫자 교차검증) 낱개 정가를 기준으로
//   개당 정가·할인율을 복원한다. 검증 실패 시 추측하지 않고 개당 통일(할인 0%)로 안전 강등(①).
//
// 핵심 안전장치: 이름이 비슷해도 "buyN = 묶음총액 / 낱개판매가" 가 정수가 아니면 매칭을 버린다.
//   (예: 5+2 → 115,010 / 23,000 = 5.0 ✅ / 3+1 → 69,000 / 23,000 = 3.0 ✅)
import type { NormalizedProduct } from './schema.js';
import { BUNDLE, STOPWORDS } from '../config.js';

const round1 = (n: number) => Math.round(n * 10) / 10;

// 가족 토큰에서 제거할 불용어 (변종/마케팅/소비기한 등 식별에 무의미)
const STOP = STOPWORDS.familyToken;

/** 상품명에서 묶음/변종 노이즈를 제거하고 "상품 가족" 토큰만 남긴다. */
export function familyTokens(name: string | null): Set<string> {
  if (!name) return new Set();
  const s = name
    .replace(/\d+\s*\+\s*\d+/g, ' ') // 5+2, 3+1
    .replace(/buy\s*\d+\s*get\s*\d+/gi, ' ') // BUY 5 GET 2
    .replace(/골라\s*담기|개당\s*가격|묶음|세트/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ') // [개당 가격], [소비기한 …], [BLACK SPIRIT FLAVOR]
    .replace(/\([^)]*\)/g, ' '); // (소비기한 …)
  const toks = s
    .split(/[\s\-–·,/]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return new Set(toks.filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOP.has(t)));
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

interface BundleInfo {
  pno: string;
  rows: NormalizedProduct[];
  tokens: Set<string>;
  brand: string | null;
  perUnit: number; // 묶음 개당가 (현재 consumer_price의 base)
  total: number; // 묶음 전체 결제금액 (현재 sales_price의 base)
  name: string | null;
}

interface SingleInfo {
  pno: string;
  tokens: Set<string>;
  brand: string | null;
  listUnit: number | null; // 낱개 정가(소비자가) = consumer_price
  saleUnit: number | null; // 낱개 판매가 = sales_price
}

/** 묶음 시그널: 이름(골라담기/N+M/개당가격) + 단위 불일치(판매 ≈ 정가의 정수배). 둘 다일 때만. */
function isBundle(rows: NormalizedProduct[]): boolean {
  const name = rows[0].data.name ?? '';
  const nameSig = /골라\s*담기|개당\s*가격|\d+\s*\+\s*\d+|buy\s*\d+\s*get\s*\d+/i.test(name);
  const mismatch = rows.some((r) => {
    const c = r.data.consumer_price;
    const s = r.data.sales_price;
    return c != null && s != null && c > 0 && s / c >= BUNDLE.unitMismatchRatio; // 판매가 개당의 ~2배+ → 단위 섞임
  });
  return nameSig && mismatch;
}

/** 상품의 SKU들 중 base(추가금 없는) 가격 = 최소값 */
function minField(rows: NormalizedProduct[], f: 'consumer_price' | 'sales_price'): number | null {
  const vals = rows.map((r) => r.data[f]).filter((v): v is number => v != null && v > 0);
  return vals.length ? Math.min(...vals) : null;
}

export interface BundleResolveReport {
  bundles: number;
  matched: number;
  fallback: number;
  details: {
    productNo: string;
    name: string | null;
    result: 'matched' | 'fallback';
    ref?: string;
    discount?: number;
  }[];
}

/**
 * 묶음 상품 가격을 보정한다(in-place). 전 상품 수집이 끝난 뒤 validate 직전에 1회 호출.
 * @returns 보정 리포트(매칭/폴백 건수)
 */
export function resolveBundlePricing(rows: NormalizedProduct[]): BundleResolveReport {
  // 1) 상품(productNo) 단위로 묶기
  const byProduct = new Map<string, NormalizedProduct[]>();
  for (const r of rows) {
    const arr = byProduct.get(r.meta.productNo);
    if (arr) arr.push(r);
    else byProduct.set(r.meta.productNo, [r]);
  }

  // 2) 묶음 / 낱개 분류
  const bundles: BundleInfo[] = [];
  const singles: SingleInfo[] = [];
  for (const [pno, prs] of byProduct) {
    const rep = prs[0].data;
    const tokens = familyTokens(rep.name);
    if (isBundle(prs)) {
      const perUnit = minField(prs, 'consumer_price');
      const total = minField(prs, 'sales_price');
      if (perUnit != null && total != null) {
        bundles.push({ pno, rows: prs, tokens, brand: rep.brand_name, perUnit, total, name: rep.name });
      }
    } else {
      singles.push({
        pno,
        tokens,
        brand: rep.brand_name,
        listUnit: minField(prs, 'consumer_price'),
        saleUnit: minField(prs, 'sales_price'),
      });
    }
  }

  // 3) 묶음마다 낱개 매칭 → 복원 or 폴백
  const report: BundleResolveReport = { bundles: bundles.length, matched: 0, fallback: 0, details: [] };
  for (const b of bundles) {
    const ref = findReference(b, singles);
    if (ref) {
      applyMatched(b, ref);
      report.matched++;
      report.details.push({ productNo: b.pno, name: b.name, result: 'matched', ref: ref.sg.pno, discount: ref.discount });
    } else {
      applyFallback(b);
      report.fallback++;
      report.details.push({ productNo: b.pno, name: b.name, result: 'fallback' });
    }
  }
  return report;
}

interface RefMatch {
  sg: SingleInfo;
  qty: number;
  buyN: number;
  discount: number;
  err: number;
}

/** 낱개 후보 중 이름(토큰 2+ 공유) + 숫자 교차검증을 통과하는 최적 매칭을 찾는다. */
function findReference(b: BundleInfo, singles: SingleInfo[]): RefMatch | null {
  const qty = Math.round(b.total / b.perUnit); // 묶음 개수 (예 7)
  if (qty < 2) return null;
  let best: RefMatch | null = null;
  for (const sg of singles) {
    if (sg.saleUnit == null || sg.listUnit == null) continue;
    if (b.brand && sg.brand && b.brand !== sg.brand) continue; // 브랜드 다르면 제외
    if (intersectionSize(b.tokens, sg.tokens) < 2) continue; // 핵심 토큰 2개+ 공유(이름 후보)

    // ── 숫자 교차검증 (오매칭 차단) ──
    // buyN = 묶음총액 / 낱개판매가 가 정수여야 함 (낸 값 = N개분), 1 ≤ buyN < qty(=받는 개수)
    const buyNreal = b.total / sg.saleUnit;
    const buyN = Math.round(buyNreal);
    const ok =
      buyN >= 1 &&
      buyN < qty && // 받는 개수보다 낸 개수가 적어야 진짜 "+M 무료"
      Math.abs(buyNreal - buyN) / buyN <= 0.01 && // 오차 1% 이내
      b.perUnit < sg.saleUnit && // 묶음 개당이 낱개 판매가보다 싸야(혜택)
      sg.listUnit >= sg.saleUnit; // 낱개 정가 ≥ 판매가 (정합성)
    if (!ok) continue;

    const discount = round1(((sg.listUnit - b.perUnit) / sg.listUnit) * 100);
    if (discount < 0 || discount > 100) continue;
    const err = Math.abs(buyNreal - buyN);
    if (!best || err < best.err) best = { sg, qty, buyN, discount, err };
  }
  return best;
}

/** ②a: 낱개 정가를 기준으로 개당 정가·할인 복원 (SKU별 옵션 추가금 보존). */
function applyMatched(b: BundleInfo, ref: RefMatch) {
  const listUnit = ref.sg.listUnit!; // 낱개 정가 (예 32,000)
  const baseUnit = b.perUnit; // 묶음 개당 (예 16,430)
  for (const r of b.rows) {
    const add = (r.data.consumer_price ?? baseUnit) - baseUnit; // 이 SKU의 옵션 추가금(보통 0)
    const newSales = baseUnit + add; // 개당 판매 (16,430 + add)
    const newConsumer = listUnit + add; // 개당 정가 (32,000 + add)
    r.data.sales_price = newSales;
    r.data.consumer_price = newConsumer;
    r.data.discount_rate = newConsumer > 0 ? round1(((newConsumer - newSales) / newConsumer) * 100) : null;
    // 묶음 정보는 option2(실제 옵션 축 자리)를 건드리지 않고 name·meta.bundle로만 전달한다.
    r.provenance.consumer_price = {
      method: 'calculated',
      source: `낱개상품 ${ref.sg.pno} 정가 기준(묶음 개당 정가 추론)`,
    };
    r.provenance.sales_price = { method: 'calculated', source: `묶음 개당가(총액 ${b.total} ÷ ${ref.qty}개)` };
    r.provenance.discount_rate = { method: 'calculated', source: `낱개 정가 대비 묶음 개당 할인` };
    r.meta.bundle = { quantity: ref.qty, total: b.total, refProductNo: ref.sg.pno, refUnitListPrice: listUnit, basis: '단일정가' };
  }
}

/** ①: 매칭 실패 → 추측 없이 개당 통일(판매=정가=개당, 할인 0%). 묶음 총액은 meta에 보존. */
function applyFallback(b: BundleInfo) {
  const qty = Math.round(b.total / b.perUnit);
  for (const r of b.rows) {
    const base = r.data.consumer_price ?? b.perUnit; // 개당(추가금 포함)
    r.data.sales_price = base; // 판매 = 정가 = 개당으로 통일
    r.data.consumer_price = base;
    r.data.discount_rate = 0; // 묶음 listing엔 정가 없음 → 개당 기준 할인 0%
    // 묶음 정보는 option2를 건드리지 않고 name·meta.bundle로만 전달 (qty는 meta.bundle에 기록)
    r.provenance.consumer_price = { method: 'deterministic', source: `묶음 개당가(낱개 매칭 실패로 정가 미확보)` };
    r.provenance.sales_price = { method: 'deterministic', source: `묶음 개당가(총 ${b.total} ÷ ${qty}개) — 낱개 매칭 실패` };
    r.provenance.discount_rate = { method: 'calculated', source: `개당 통일(할인 정보 없음)` };
    r.meta.bundle = { quantity: qty, total: b.total, refProductNo: null, basis: '개당통일(매칭실패)' };
  }
}
