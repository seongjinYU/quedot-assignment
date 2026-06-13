// happyland 상세 이미지 구조 정찰 (tsx 실행: npx tsx src/recon-happyland.ts)
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
(chromium as any).use(stealthPlugin());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const targets = ['1000000642', '1000000641', '1000000640'];

(async () => {
  const browser = await (chromium as any).launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  for (const no of targets) {
    await page.goto(`https://m.happylandmall.com/goods/goods_view.php?goodsNo=${no}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await sleep(2500);
    await page.mouse.wheel(0, 3000);
    await sleep(1500);
    const info = await page.evaluate(() => {
      const containers = ['#detail', '.detail', '.goods_detail', '.detail_cont', '.goods_description', '#prdDetail', '.cont_detail', '.goods_view_cont', '.goods_explan', '.detail_explan'];
      let area: string | null = null;
      for (const s of containers) { if (document.querySelector(s)) { area = s; break; } }
      const root = area ? document.querySelector(area)! : document.body;
      const imgs = [...root.querySelectorAll('img')]
        .map((im: any) => ({ src: im.src || im.getAttribute('data-src') || '', alt: im.alt || '', w: im.naturalWidth, h: im.naturalHeight }))
        .filter((x) => x.src && /goods/.test(x.src));
      return { area, total: imgs.length, first8: imgs.slice(0, 8) };
    });
    console.log(`\n===== goodsNo ${no} =====`);
    console.log('상세영역:', info.area, '| 이미지수:', info.total);
    info.first8.forEach((im: any, i: number) => {
      console.log(`  [${i}] ${im.w}x${im.h} alt="${im.alt}" FULLSRC=${im.src}`);
    });
    // 첫 상세 이미지 요소를 직접 스크린샷 (CDN/referer 우회 → 실물 확인)
    try {
      const firstImg = page.locator(`${info.area || 'body'} img`).first();
      await firstImg.scrollIntoViewIfNeeded({ timeout: 5000 });
      await sleep(800);
      await firstImg.screenshot({ path: `/tmp/hl_detail_${no}.png` });
      console.log(`  → screenshot saved: /tmp/hl_detail_${no}.png`);
    } catch (e: any) {
      console.log(`  → screenshot 실패: ${e.message}`);
    }
  }
  await ctx.close();
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
