// 플로우차트 2종(A 개요 / B 상세)을 각각 PDF로 저장.
// Mermaid를 헤드리스에서 강제 렌더 → 각 카드를 단독 페이지로 캡처해 PDF 출력.
const { chromium } = require("playwright");
const path = require("path");

const HTML = "file://" + path.resolve(__dirname, "flow-preview.html");
const OUT_A = path.resolve(__dirname, "flow-A-개요.pdf");
const OUT_B = path.resolve(__dirname, "flow-B-상세.pdf");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(HTML, { waitUntil: "networkidle" });

  // <details>를 열어 B 차트도 렌더되게 한 뒤, 두 mermaid가 모두 SVG로 변환될 때까지 대기
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".mermaid svg").length >= 2,
    { timeout: 20000 },
  );
  await page.waitForTimeout(600); // 폰트/레이아웃 안정화

  // 각 카드를 단독으로 PDF에 담기 위한 헬퍼: 대상 카드만 보이게 하고 print
  async function exportCard(cardIndex, title, outPath) {
    await page.evaluate(
      ({ idx, title }) => {
        const cards = document.querySelectorAll(".card");
        document.querySelectorAll(".card").forEach((c, i) => {
          c.style.display = i === idx ? "block" : "none";
        });
        // 제목 한 줄만 남기고 부수 UI 숨김
        document
          .querySelectorAll("h1,.note,.legend,.kicker,details>summary,footer,.brand")
          .forEach((el) => (el.style.display = "none"));
        let h = document.getElementById("__pdf_title");
        if (!h) {
          h = document.createElement("div");
          h.id = "__pdf_title";
          document.querySelector(".wrap").prepend(h);
        }
        h.textContent = title;
        h.style.cssText =
          "font-family:Pretendard,system-ui,sans-serif;font-weight:900;font-size:22px;letter-spacing:-.6px;color:#0B1220;margin:0 0 14px;";
        // details가 닫히면 카드 숨으니 강제로 열어둠
        document.querySelectorAll("details").forEach((d) => (d.open = true));
        document.querySelectorAll("details").forEach((d) => {
          d.style.margin = "0";
        });
      },
      { idx: cardIndex, title },
    );
    await page.waitForTimeout(200);

    // 카드 실제 크기에 맞춰 페이지 크기 결정 (가로 차트가 잘리지 않게)
    const box = await page.evaluate((idx) => {
      const card = document.querySelectorAll(".card")[idx];
      const r = card.getBoundingClientRect();
      return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
    }, cardIndex);

    const padX = 48;
    const padY = 56;
    await page.pdf({
      path: outPath,
      printBackground: true,
      width: `${box.w + padX * 2}px`,
      height: `${box.h + padY + 70}px`,
      margin: { top: `${padY}px`, bottom: "24px", left: `${padX}px`, right: `${padX}px` },
    });
    // PNG도 함께 저장 (GitHub README 인라인 임베드용 — PDF는 인라인 렌더 안 됨)
    const pngOut = path.resolve(__dirname, cardIndex === 0 ? "flow-A.png" : "flow-B.png");
    await page.locator(".card").nth(cardIndex).screenshot({ path: pngOut });
    console.log("saved:", outPath, "+", pngOut, `(${box.w}x${box.h})`);
  }

  // A 먼저 (B는 A를 숨겼다 다시 보여야 하므로 매번 reload로 깨끗하게)
  await exportCard(0, "큐닷 AX — 파이프라인 개요 (6단계)", OUT_A);

  // 페이지 상태가 변형됐으니 reload 후 B 캡처
  await page.goto(HTML, { waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await page.waitForFunction(() => document.querySelectorAll(".mermaid svg").length >= 2, { timeout: 20000 });
  await page.waitForTimeout(600);
  await exportCard(1, "큐닷 AX — 상세 동작 흐름 (분기 · 검증 관문)", OUT_B);

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
