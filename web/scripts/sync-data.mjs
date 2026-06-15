// 빌드/실행 전 ../output/*.json 을 web/data/ 로 복사하고 카드용 index.json 을 생성한다.
// output/ 은 읽기 전용(재크롤이 덮어쓰므로 web에서 쓰지 않는다). predev/prebuild 훅으로 자동 실행.

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..'); // quedot-assignment/
const outputDir = join(repoRoot, 'output');
const dataDir = resolve(here, '..', 'data'); // web/data/
const publicRunsDir = resolve(here, '..', 'public', 'runs'); // web/public/runs/ (클라이언트 fetch용)

if (!existsSync(outputDir)) {
  console.error(`[sync-data] output/ 를 찾을 수 없습니다: ${outputDir}`);
  process.exit(1);
}

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
rmSync(publicRunsDir, { recursive: true, force: true });
mkdirSync(publicRunsDir, { recursive: true });

const all = readdirSync(outputDir).filter((f) => f.endsWith('.json'));
// 스토어 결과 파일만: 사이드카(.quality / .cache 등) 제외
const found = all
  .filter(
    (f) =>
      !f.endsWith('.quality.json') &&
      !f.endsWith('.cache.json') &&
      !f.endsWith('.state.json') &&
      !f.endsWith('.run.json')
  )
  .map((f) => f.replace(/\.json$/, ''));

// 표시 순서 고정: 지정 순서 우선, 나머지는 알파벳
const ORDER = ['phytonutri', 'kefii', 'happylandmall'];
const stores = found.sort((a, b) => {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
});

const index = [];
for (const slug of stores) {
  const productsRaw = readFileSync(join(outputDir, `${slug}.json`), 'utf8');
  const products = JSON.parse(productsRaw);
  if (!Array.isArray(products)) {
    console.warn(`[sync-data] '${slug}.json' 이 배열이 아니라 스킵`);
    continue;
  }
  writeFileSync(join(dataDir, `${slug}.json`), productsRaw);

  let quality = null;
  const qPath = join(outputDir, `${slug}.quality.json`);
  if (existsSync(qPath)) {
    const qRaw = readFileSync(qPath, 'utf8');
    quality = JSON.parse(qRaw);
    writeFileSync(join(dataDir, `${slug}.quality.json`), qRaw);
  }

  // 실행 기록(run-log) — /demo 파이프라인 재생용. 클라이언트가 fetch하도록 public/runs/ 에도 복사.
  const runPath = join(outputDir, `${slug}.run.json`);
  let hasRun = false;
  if (existsSync(runPath)) {
    const runRaw = readFileSync(runPath, 'utf8');
    writeFileSync(join(dataDir, `${slug}.run.json`), runRaw);
    writeFileSync(join(publicRunsDir, `${slug}.run.json`), runRaw);
    hasRun = true;
  }

  const sampleImages = [];
  for (const p of products) {
    const u = p?.data?.image_url;
    if (u && !sampleImages.includes(u)) sampleImages.push(u);
    if (sampleImages.length >= 4) break;
  }
  const recoveredRows = products.filter(
    (p) => Array.isArray(p?.meta?.recovered) && p.meta.recovered.length > 0
  ).length;

  index.push({
    slug,
    store: quality?.store ?? slug,
    totalProducts: quality?.totalProducts ?? null,
    totalRows: quality?.totalRows ?? products.length,
    aiUsage: quality?.aiUsage ?? null,
    validationIssues: quality?.validationIssues
      ? {
          error: quality.validationIssues.error,
          warn: quality.validationIssues.warn,
        }
      : null,
    recoveredRows,
    crawledAt: products?.[0]?.meta?.crawledAt ?? null,
    sampleImages,
    hasRun,
  });
}

writeFileSync(
  join(dataDir, 'index.json'),
  JSON.stringify({ stores: index, generatedAt: new Date().toISOString() }, null, 2)
);

console.log(
  `[sync-data] ${stores.length}개 스토어 → web/data (${stores.join(', ')})`
);
