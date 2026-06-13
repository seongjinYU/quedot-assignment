// 에누리(가격비교) 최저가 조회기 — 쿠팡 포함 오픈마켓(11번가·G마켓·옥션·롯데·SSG) 가격을 한 번에.
// 쿠팡 직접크롤(Akamai)·파트너스API(키요건)가 막혀, 가격비교 사이트를 합법적 우회로로 활용.
// 가격이 JS 렌더라 Playwright 필요(에누리는 차단 약해 stealth 불필요).
// 성능: page 풀(기본 4) + 세마포어로 동시 검색 — 109개도 수 분 내(순차 대비 ~4배 단축).
import { chromium, type Browser, type Page } from 'playwright';
import { SEARCH, TIMING } from '../config.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface EnuriItem {
  name: string; // h3.item__model 상품명 — 매칭용
  price: number; // .col--price em (비쿠폰 표시가)
  mall: string; // 판매처(img[alt]: 11번가/G마켓/SSG...) — 출처
  coupon: boolean; // 쿠폰가 뱃지(ico-tag--coupon) 여부 — 정책상 lowest_price엔 비쿠폰만 사용
}

export class EnuriClient {
  private browser?: Browser;
  private pages: Page[] = [];
  private free: Page[] = [];
  private waiters: ((p: Page) => void)[] = [];

  constructor(private poolSize = SEARCH.enuriPoolSize) {}

  async init(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: true });
    for (let i = 0; i < this.poolSize; i++) {
      const ctx = await this.browser.newContext({ userAgent: UA, locale: 'ko-KR', viewport: { width: 1280, height: 1600 } });
      this.pages.push(await ctx.newPage());
    }
    this.free = [...this.pages];
  }

  /** 풀에서 가용 page 획득(없으면 대기) — 동시 검색을 poolSize로 제한. */
  private acquire(): Promise<Page> {
    const p = this.free.pop();
    if (p) return Promise.resolve(p);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  private release(p: Page): void {
    const w = this.waiters.shift();
    if (w) w(p);
    else this.free.push(p);
  }

  /**
   * 상품명 query로 검색 → 최저가순 정렬 후 상위 카드(상품명·가격·판매처·쿠폰) 추출. 실패 시 throw(호출부 격리).
   * 추출은 OCR이 아니라 li.prodItem 카드의 DOM 텍스트 직접 읽기(결정적):
   *   상품명 h3.item__model · 가격 .col--price em · 판매처 .price__mall img[alt] · 쿠폰 i.ico-tag--coupon
   * 쿠폰행은 적용가가 별도 위치라 .col--price em이 비어 자동 제외 → 비쿠폰 표시가만 남음(정책 ③).
   */
  async search(query: string): Promise<EnuriItem[]> {
    if (!this.browser) await this.init();
    const p = await this.acquire();
    try {
      await p.goto('https://www.enuri.com/search.jsp?keyword=' + encodeURIComponent(query), { waitUntil: 'domcontentloaded', timeout: 40000 });
      // 결과 카드가 뜨면 바로 진행(조건부 대기 — 네트워크 빠르면 단축). 없으면 고정 대기로 폴백(0건 케이스).
      await p.waitForSelector('li.prodItem', { timeout: TIMING.enuriPageSettle }).catch(() => {});
      // 최저가순 정렬(베스트에포트) — 클릭 실패해도 아래 evaluate에서 JS로 오름차순 보정하므로 안전
      try {
        await p.getByText('최저가순', { exact: false }).first().click({ timeout: 4000 });
        await p.waitForTimeout(TIMING.enuriSortSettle);
      } catch { /* 정렬 실패 → JS 정렬로 보정 */ }
      await p.mouse.wheel(0, 1000);
      await p.waitForTimeout(TIMING.enuriScrollSettle);

      const items: EnuriItem[] = await p.evaluate((maxCards) => {
        const out: { name: string; price: number; mall: string; coupon: boolean }[] = [];
        const cards = document.querySelectorAll('li.prodItem');
        for (let i = 0; i < cards.length && out.length < maxCards; i++) {
          const card = cards[i];
          const name = (card.querySelector('h3.item__model')?.textContent || '').replace(/\s+/g, ' ').trim();
          const priceTx = card.querySelector('.col--price em')?.textContent || '';
          const price = parseInt(priceTx.replace(/[^\d]/g, ''), 10);
          const coupon = !!card.querySelector('.ico-tag--coupon') || /추가할인\s*쿠폰/.test(card.textContent || '');
          if (!name || !price || price < 1000) continue; // 쿠폰행(가격 비어있음)·노이즈 제외
          const mallImg = card.querySelector('.price__mall img[alt]') as HTMLImageElement | null;
          const mall = mallImg?.getAttribute('alt') || '';
          out.push({ name: name.slice(0, 80), price, mall, coupon });
        }
        out.sort((a, b) => a.price - b.price); // 정렬 클릭 실패 대비 — 항상 오름차순 보장
        return out;
      }, SEARCH.enuriMaxCards);

      return items;
    } finally {
      this.release(p);
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
  }
}
