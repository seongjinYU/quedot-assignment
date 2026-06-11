# web/ — 큐닷 정규화 결과 검수 뷰어

브랜드 스토어 크롤 → AI 정규화 산출물(`../output/*.json`)을 **출처(provenance) 단위로 검수**하는 읽기 전용 뷰어.
크롤 파이프라인과 **완전히 격리**되어 있고(자체 `package.json`), DB·서버 없이 **Vercel 정적 배포(SSG)**된다.

## 무엇을 보여주나

- **스토어 카드**(홈): 스토어별 상품/SKU 수, AI 보강량, 검증 오류·경고, 수집일.
- **검수 테이블**(`/store/[slug]`): SKU 한 행마다 모든 필드를 **provenance.method 색으로 코딩**.
  - 🟢 결정적(원본 그대로·신뢰) / 🔵 크롤 / 🟡 계산 / 🟣 AI(생성·분류) / 🔴 자가복구(확인 필요) / ⚪ 공란(사유 표기)
  - **무채색 = 믿어도 됨, 유채색 = 검수 대상**. 사람이 🟣🔴⚪만 빠르게 훑게 만드는 게 목적.
  - 행 펼침 → 필드별 근거(source/reason) + 원본 메타(옵션 축·묶음·네이버 MID·수집 시각·원본 링크).
  - 필터: 🔴확인필요 / 🟣AI포함 / ⚪공란포함 / 품절 / 카테고리 / 검색.
  - 상단 **품질 요약**: 필드별 채움률, 검증 오류·경고, AI 보강/룰 폴백, 공란 사유.

## 아키텍처

```
../output/*.json (git 커밋됨, 읽기 전용)
   │  scripts/sync-data.mjs   (predev/prebuild 훅: 복사 + index.json 생성)
   ▼
web/data/{store}.json · {store}.quality.json · index.json   (gitignore, 재생성)
   │  lib/data.ts (서버 컴포넌트가 빌드 때 fs 로 읽음 → SSG)
   ▼
정적 HTML (Vercel)
```

- **Supabase·DB 없음**: 데이터는 정적(수백~천 행, ~2MB)이라 번들이면 충분. 이미지는 원본 CDN URL을 `<img loading="lazy">`로 직접 참조(이미지 호스팅 불필요).
- **격리 규칙**: 루트 `package.json`·`src/` 를 건드리지 않는다. `../output` 은 **읽기만** 한다(재크롤이 덮어쓰므로 쓰지 않음).
- **자가복구 선반영(forward-compatible)**: 백엔드 자가복구가 채우는 `ai-recovery` provenance·`meta.recovered` 신호를 UI가 이미 처리한다. 자가복구 적용 후엔 **재크롤 → 재배포**만 하면 🔴확인필요가 자동으로 표시된다(스키마 변경이 additive라 깨지지 않음).

## 실행

```bash
npm install
npm run dev      # predev 가 ../output → web/data 동기화 후 dev 서버
# http://localhost:3000
```

```bash
npm run build    # prebuild 동기화 후 정적 생성
npm start
```

데이터만 다시 당겨오려면: `npm run sync-data`.

## 배포 (Vercel)

- **Root Directory: `web`** 로 지정(중요 — 모노레포 하위 앱).
- Build Command / Output 은 기본값(`next build`)으로 충분. `prebuild` 훅이 빌드 클론에 포함된 `../output` 을 읽어 `web/data` 를 생성한다.
- **환경변수 불필요**(크롤·AI 키는 로컬 전용, 여긴 정적 결과만 읽음).

## 왜 "URL 입력 → 라이브 크롤"이 없나 (의도된 선택)

네이버 스마트스토어/브랜드스토어는 데이터센터 IP를 차단하고 캡차를 띄우며, 수집에 **사용자 본인 로그인 세션**이 필요하다. 이를 공개 서버에 라이브로 올리려면 본인 인증 세션을 공개 엔드포인트에 노출해야 하고, 누구나 네이버를 긁는 "차단 우회 서비스"가 된다 — 과제 원칙(*차단 우회 자랑이 아니라 리스크 인식 / 본인 세션 재사용*)에 어긋난다.
그래서 **크롤은 로컬에서 인증 세션으로 실행**하고, 이 뷰어는 그 **결과를 정직하게 전시**한다. 배포의 가치는 "크롤러 재실행"이 아니라 평가자가 셋업 0으로 **수집·AI 분석·정규화 품질과 그 투명성을 직접 검수**하는 데 있다.
