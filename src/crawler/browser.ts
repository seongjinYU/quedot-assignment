// 브라우저 세션 — persistent context(인증 세션 재사용) + 내부 API 직접 호출
// 핵심: 살아있는 세션 안에서 page.evaluate(fetch)로 내부 JSON API를 직접 호출한다.
//       → 쿠키/세션 자동 포함, same-origin이라 CORS 없음, 화면 파싱 불필요(결정적).
import { chromium as chromiumExtra } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SESSION = path.resolve(__dirname, '../../naver-session');

// stealth 적용 (자동화 흔적 제거)
(chromiumExtra as any).use(stealthPlugin());

export interface ApiResult<T = any> {
  status: number;
  ok: boolean;
  body: T;
}

export class BrowserSession {
  private ctx!: BrowserContext;
  private page!: Page;

  constructor(
    private opts: {
      userDataDir?: string;
      headless?: boolean;
      rateLimitMs?: number; // 요청 간 최소 간격 (매너)
    } = {},
  ) {}

  /** 브라우저를 열고 origin 페이지를 띄워 세션을 확보한다. */
  async open(originUrl: string): Promise<void> {
    const userDataDir = this.opts.userDataDir ?? DEFAULT_SESSION;
    this.ctx = await (chromiumExtra as any).launchPersistentContext(userDataDir, {
      headless: this.opts.headless ?? false,
      channel: 'chrome',
      locale: 'ko-KR',
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    await this.page.goto(originUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForTimeout(1500);
  }

  /** 네이버 로그인 여부 (NID_AUT 쿠키) */
  async isNaverLoggedIn(): Promise<boolean> {
    const cookies = await this.ctx.cookies();
    return cookies.some((c) => c.name === 'NID_AUT');
  }

  /** 사용자가 직접 로그인할 때까지 대기 (persistent 세션에 저장됨) */
  async waitForNaverLogin(maxMs = 360000): Promise<boolean> {
    if (await this.isNaverLoggedIn()) return true;
    await this.page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(3000);
      if (await this.isNaverLoggedIn()) return true;
    }
    return false;
  }

  private async throttle() {
    if (this.opts.rateLimitMs) await this.page.waitForTimeout(this.opts.rateLimitMs);
  }

  /** 내부 API GET (브라우저 세션 컨텍스트에서 실행) */
  async apiGet<T = any>(url: string): Promise<ApiResult<T>> {
    await this.throttle();
    return this.page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include', headers: { accept: 'application/json' } });
      let body: any = null;
      try { body = await r.json(); } catch { body = null; }
      return { status: r.status, ok: r.ok, body };
    }, url);
  }

  /** 내부 API POST (JSON body) */
  async apiPost<T = any>(url: string, payload: unknown): Promise<ApiResult<T>> {
    await this.throttle();
    return this.page.evaluate(
      async ({ u, p }) => {
        const r = await fetch(u, {
          method: 'POST',
          credentials: 'include',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(p),
        });
        let body: any = null;
        try { body = await r.json(); } catch { body = null; }
        return { status: r.status, ok: r.ok, body };
      },
      { u: url, p: payload },
    );
  }

  /** 현재 페이지의 __PRELOADED_STATE__ 추출 */
  async preloadedState<T = any>(): Promise<T | null> {
    return this.page.evaluate(() => (window as any).__PRELOADED_STATE__ ?? null);
  }

  /** 현재 페이지 DOM에서 데이터 추출 (HTML 파싱형 스토어용) */
  async extract<T>(pageFunction: () => T): Promise<T> {
    return this.page.evaluate(pageFunction);
  }

  /** 특정 URL로 이동 (상세 페이지 SSR 상태 확보용) */
  async goto(url: string): Promise<void> {
    await this.throttle();
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForTimeout(1000);
  }

  /** 페이지 하단까지 스크롤 (지연 로딩/페이지네이션 노출용) */
  async scrollBottom(times = 5): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.page.mouse.wheel(0, 2500);
      await this.page.waitForTimeout(800);
    }
  }

  /**
   * 텍스트 버튼을 클릭하고, 그 결과로 발생하는 JSON 응답을 가로챈다.
   * (직접 fetch는 서명헤더 부재로 429 → 브라우저가 스스로 부르게 유도)
   */
  async captureJsonOnClick<T = any>(
    clickText: string,
    urlIncludes: string,
    timeoutMs = 10000,
  ): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      let done = false;
      const finish = (v: T | null) => {
        if (done) return;
        done = true;
        this.page.off('response', handler);
        resolve(v);
      };
      const handler = async (res: import('playwright').Response) => {
        if (done || !res.url().includes(urlIncludes)) return;
        if (!(res.headers()['content-type'] || '').includes('json')) return;
        try {
          finish((await res.json()) as T);
        } catch {
          /* ignore */
        }
      };
      this.page.on('response', handler);
      this.page
        .evaluate((t) => {
          const els = [...document.querySelectorAll('a, button')].filter(
            (e) => (e.textContent || '').trim() === t,
          );
          if (els.length) {
            (els[els.length - 1] as HTMLElement).click();
            return true;
          }
          return false;
        }, clickText)
        .then((clicked) => {
          if (!clicked) finish(null);
        });
      setTimeout(() => finish(null), timeoutMs);
    });
  }

  async close(): Promise<void> {
    await this.ctx?.close();
  }
}
