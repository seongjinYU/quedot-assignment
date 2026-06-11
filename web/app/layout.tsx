import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "큐닷 정규화 결과 뷰어",
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
      <body className="min-h-full flex flex-col text-slate-900">{children}</body>
    </html>
  );
}
