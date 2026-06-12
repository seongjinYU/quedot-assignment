import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "큐닷 정규화 결과 검수 · Provenance Ledger",
  description:
    "브랜드 스토어 전 상품 크롤링 → AI 정규화 결과. 모든 필드의 출처(provenance)를 추적·검수합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {children}
        <footer className="mt-auto border-t border-rule">
          <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center justify-between gap-3 px-5 py-6 font-mono text-[11px] tracking-wide text-ink-soft">
            <span>QUEDOT · NORMALIZATION AUDIT</span>
            <span className="text-right">
              크롤은 로컬 인증 세션에서 실행 — 본 화면은 그 결과를 검수 전시
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
