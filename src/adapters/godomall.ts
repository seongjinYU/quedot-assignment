// 고도몰(Godomall / NHN Commerce) 범용 어댑터 — 순수 HTTP fetch + cheerio
// happyland 공식몰이 고도몰로 구축돼 있고, 고도몰 기반 몰은 HTML 구조가 동일하므로
// 도메인 하드코딩 대신 "고도몰 플랫폼" 자체를 대상으로 한다 → 다른 고도몰 링크도 작동.
//   - 목록: GET /goods/goods_list.php?cateCd={code}  → 카드 data 속성(goodsNo/nm/price/image/optionfl)
//   - 옵션: POST /goods/layer_option.php (쿠키 + X-Requested-With) → data-option-name="축1:축2"
//   - 멀티브랜드몰: 상품명 "[브랜드] ..." / 할인 표시 거의 없는 정가 판매
// 선택 전략: 네이버가 아닌 몰 URL을 후보로 받고, 첫 fetch에서 고도몰 마커를 검증(아니면 명확히 에러).
// ⚠️ robots.txt가 AI봇 차단 → 일반 UA + rate limit 준수 (회고에 명시)
import * as cheerio from 'cheerio';
import type { StoreAdapter, RawProduct, OptionCombo, ListOptions } from './types.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 고도몰/NHN커머스 구축 흔적 (CDN·표준 페이지·카드 속성) — 1개라도 있으면 고도몰로 판단
const GODOMALL_MARKER = /godomall|nhn-commerce|nhncommerce|goods_view\.php|goods_list\.php|layer_option\.php|data-goods-no/i;

interface CardData {
  no: string;
  name: string | null;
  price: number | null;
  image: string | null;
  hasOption: boolean;
  cateCd: string | null; // 소속 카테고리(의미있는 리프 우선). categoryPath 근거.
}

// 카테고리 근거로 부적합한 일반/구조 라벨 (브랜드 SHOP 진입점 등)
const GENERIC_CATE = new Set(['SHOP', 'ALL', 'BEST', 'NEW', '신상품', '베스트', '전체']);

function isMeaningfulCateName(name: string): boolean {
  const t = name.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 30) return false;
  if (GENERIC_CATE.has(t.toUpperCase()) || GENERIC_CATE.has(t)) return false;
  return /[가-힣]/.test(t); // 한글 카테고리명만 채택(브랜드 영문/구조 라벨 배제)
}

export class GodomallAdapter implements StoreAdapter {
  readonly name = 'godomall';
  readonly needsBrowser = false; // 순수 HTTP — 브라우저 불필요
  private cookie = '';
  private cardCache = new Map<string, CardData>();
  private cateNames = new Map<string, string>(); // cateCd → 의미있는 카테고리명
  private verified = false; // 고도몰 구조 검증 여부 (런타임 1회)
  private rateLimitMs: number;
  private collectDetailImages: boolean; // OCR용 상세 이미지 수집 여부 (기본 off → 추가 요청 0)

  constructor(opts: { rateLimitMs?: number; collectDetailImages?: boolean } = {}) {
    this.rateLimitMs = opts.rateLimitMs ?? 300; // 고도몰은 차단 약함 → 짧은 딜레이
    this.collectDetailImages = opts.collectDetailImages ?? false;
  }

  /**
   * 네이버가 아닌 몰 URL을 모두 후보로 받는다(고도몰 범용 = 비네이버 기본 어댑터).
   * 실제 고도몰 여부는 첫 fetch 후 assertGodomall()로 런타임 검증 → 아니면 명확한 에러.
   * (알려진 고도몰 happylandmall.com 포함, 다른 고도몰 도메인도 자동 후보)
   */
  matches(url: string): boolean {
    if (!/^https?:\/\//.test(url)) return false;
    if (/(^|\.)naver\.com/i.test(url)) return false; // 네이버는 NaverStoreAdapter 담당
    return true;
  }

  private origin(url: string): string {
    return new URL(url).origin;
  }

  /** 첫 HTML에서 고도몰 마커 확인. 아니면 "지원 어댑터 없음"을 명확히 알림(다른 링크 graceful 실패). */
  private assertGodomall(html: string, origin: string): void {
    if (this.verified) return;
    if (!GODOMALL_MARKER.test(html)) {
      throw new Error(
        `고도몰(Godomall) 구조가 아닌 사이트로 보입니다: ${origin}\n` +
          `  네이버/고도몰 외 플랫폼은 전용 어댑터가 필요합니다(StoreAdapter 추가). ` +
          `현재 지원: 네이버 스마트스토어·브랜드스토어, 고도몰 기반 공식몰.`,
      );
    }
    this.verified = true;
  }

  private saveCookie(res: Response) {
    const sc = (res.headers as any).getSetCookie?.() ?? [];
    for (const c of sc) {
      const kv = c.split(';')[0];
      if (kv) this.cookie += (this.cookie ? '; ' : '') + kv;
    }
  }

  private async httpGet(url: string): Promise<string> {
    const res = await fetch(url, { headers: { 'User-Agent': UA, cookie: this.cookie } });
    this.saveCookie(res);
    return res.text();
  }

  private async httpPost(url: string, body: string, referer: string): Promise<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: referer,
        cookie: this.cookie,
      },
      body,
    });
    return res.text();
  }

  async listProductNos(storeUrl: string, _opts?: ListOptions): Promise<string[]> {
    const origin = this.origin(storeUrl);
    this.cardCache.clear();
    this.cateNames.clear();
    this.verified = false;

    // 카테고리 결정: URL에 cateCd 있으면 그것만, 없으면 메인에서 수집
    let cateCds: string[];
    const direct = storeUrl.match(/cateCd=(\d+)/)?.[1];
    if (direct) {
      cateCds = [direct];
    } else {
      const mainHtml = await this.httpGet(`${origin}/`);
      this.assertGodomall(mainHtml, origin); // 고도몰 구조 검증(아니면 명확한 에러)
      const $ = cheerio.load(mainHtml);
      this.collectCateNames($); // cateCd→카테고리명 매핑 수집(근거용)
      const set = new Set<string>();
      $('a[href*="cateCd="]').each((_, a) => {
        const m = ($(a).attr('href') || '').match(/cateCd=(\d+)/);
        if (m) set.add(m[1]);
      });
      cateCds = [...set];
      console.log(`  카테고리 ${cateCds.length}개 발견 (이름 매핑 ${this.cateNames.size}개)`);
    }

    for (const cd of cateCds) {
      const html = await this.httpGet(`${origin}/goods/goods_list.php?cateCd=${cd}`);
      this.assertGodomall(html, origin); // direct cateCd 케이스에서도 검증
      const $ = cheerio.load(html);
      this.collectCateNames($); // 목록 페이지 SNB에서도 보강(direct cateCd 케이스 포함)
      // 현재 cateCd가 의미있는 카테고리명을 가지면 상품 근거로 사용
      const candCate = this.cateNames.has(cd) ? cd : null;
      let added = 0;
      $('[data-goods-no]').each((_, el) => {
        const no = $(el).attr('data-goods-no');
        if (!no) return;
        const existing = this.cardCache.get(no);
        if (!existing) {
          const price = $(el).attr('data-goods-price');
          this.cardCache.set(no, {
            no,
            name: $(el).attr('data-goods-nm') ?? null,
            price: price ? Math.round(parseFloat(price)) : null,
            image: $(el).attr('data-goods-image-src') ?? null,
            hasOption: ($(el).attr('data-optionfl') ?? '').toLowerCase() === 'y',
            cateCd: candCate,
          });
          added++;
        } else if (candCate && (!existing.cateCd || candCate.length > existing.cateCd.length)) {
          // 더 구체적인(깊은) 카테고리로 갱신 — 리프 카테고리명을 근거로 채택
          existing.cateCd = candCate;
        }
      });
      if (added) console.log(`  cateCd ${cd}: +${added}건 (누적 ${this.cardCache.size})`);
      await this.sleep();
    }

    return [...this.cardCache.keys()];
  }

  /** 카테고리 네비 앵커(cateCd→텍스트)에서 의미있는 한글 카테고리명만 매핑 */
  private collectCateNames($: cheerio.CheerioAPI) {
    $('a[href*="cateCd="]').each((_, a) => {
      const cd = ($(a).attr('href') || '').match(/cateCd=(\d+)/)?.[1];
      if (!cd) return;
      const txt = $(a).text().replace(/\s+/g, ' ').trim();
      if (isMeaningfulCateName(txt) && !this.cateNames.has(cd)) {
        this.cateNames.set(cd, txt);
      }
    });
  }

  async fetchProduct(storeUrl: string, no: string): Promise<RawProduct> {
    const origin = this.origin(storeUrl);
    const card = this.cardCache.get(no);
    const name = card?.name ?? null;
    const brandName = name?.match(/^\[([^\]]+)\]/)?.[1] ?? null;
    const sourceUrl = `${origin}/goods/goods_view.php?goodsNo=${no}`;

    // 옵션 있는 상품만 layer_option 호출 (불필요 호출 회피)
    let optionCombos: OptionCombo[] = [];
    if (card?.hasOption) {
      try {
        optionCombos = await this.fetchOptions(origin, no, sourceUrl);
      } catch {
        /* 옵션 실패해도 상품 자체는 진행 (에러 격리) */
      }
    }

    // OCR 옵션 ON일 때만 상세페이지에서 설명 이미지(_DC) 수집 (없으면 추가 요청 0)
    let detailImages: string[] | undefined;
    if (this.collectDetailImages) {
      try {
        detailImages = await this.fetchDetailImages(sourceUrl);
      } catch {
        /* 상세 이미지 실패해도 상품 진행 (에러 격리) */
      }
    }

    return {
      productNo: no,
      brandName,
      name,
      representativeImage: card?.image ?? null,
      images: card?.image ? [card.image] : [],
      // 고도몰 공식몰은 보통 정가 판매(할인 표시 없음) → 표시가를 정가·판매가 동일 처리
      consumerPrice: card?.price ?? null,
      salePrice: card?.price ?? null,
      deliveryFee: null,
      optionAxes: [],
      optionCombos,
      // 카테고리 근거: 소속 리프 카테고리명(예: "내의 / 홈웨어"). 없으면 null(상품명만 분류).
      categoryPath: card?.cateCd ? (this.cateNames.get(card.cateCd) ?? null) : null,
      sellerTags: [],
      detailText: null,
      detailImages,
      naverMid: null,
      sourceUrl,
    };
  }

  /**
   * 상세페이지(goods_view)에서 설명 이미지 URL 수집 (OCR 대상).
   * 고도몰 상세는 본문이 이미지라, 텍스트가 든 composite(_DC)를 우선 선택하고
   * 공용 안내/사이즈가이드/아이콘 이미지는 제외한다. 없으면 일반 상세 이미지로 폴백.
   */
  private async fetchDetailImages(viewUrl: string): Promise<string[]> {
    await this.sleep();
    const html = await this.httpGet(viewUrl);
    const urls = new Set<string>();
    // 1) 텍스트 composite(_DC)를 raw HTML에서 직접 추출 — m./www DOM 구조 차이에 강건
    //    (모바일은 #detail 컨테이너가 없어 셀렉터 의존이 깨짐 → 정규식이 안전)
    for (const m of html.matchAll(/https?:\/\/[^"')\s]+_DC\.(?:jpg|png|gif)/gi)) urls.add(m[0]);
    // 2) _DC가 없는 다른 고도몰 대비: 상세 컨테이너 이미지로 폴백 (공용 안내/아이콘 제외)
    if (urls.size === 0) {
      const $ = cheerio.load(html);
      $('#detail img, .cont_detail img, #prdDetail img').each((_, im) => {
        const a = (im as any).attribs || {};
        let src = a.src || a['data-src'] || a['ec-data-src'] || a['data-original'] || '';
        if (!src) return;
        if (src.startsWith('//')) src = 'https:' + src;
        if (!/^https?:\/\//.test(src)) return;
        if (/notice|size_?guide|\/icon|\/btn|common|blank|ec_md/i.test(src)) return;
        urls.add(src);
      });
    }
    return [...urls];
  }

  /** 옵션 조합: layer_option.php POST → data-option-name="축1:축2" 파싱 */
  private async fetchOptions(origin: string, no: string, referer: string): Promise<OptionCombo[]> {
    await this.sleep();
    const html = await this.httpPost(
      `${origin}/goods/layer_option.php`,
      `type=goods&goodsNo=${no}`,
      referer,
    );
    const $ = cheerio.load(html);
    const combos: OptionCombo[] = [];
    $('[data-option-name]').each((_, el) => {
      const raw = $(el).attr('data-option-name') || '';
      if (!raw) return;
      const names = raw.split(':').map((s) => s.trim()).filter(Boolean);
      if (names.length === 0) return;
      combos.push({ names, addPrice: 0, soldOut: false });
    });
    return combos;
  }

  private sleep() {
    return new Promise((r) => setTimeout(r, this.rateLimitMs));
  }
}
