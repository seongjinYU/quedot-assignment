import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 워크스페이스 루트를 web/ 로 고정(상위/홈의 떠돌이 lockfile 오인 방지).
  // Vercel Root Directory=web/ 배포와 일치.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
