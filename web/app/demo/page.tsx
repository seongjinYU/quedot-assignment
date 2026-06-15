import { getDemoStores } from '@/lib/data';
import { DemoClient } from '@/components/demo/DemoClient';

export const metadata = {
  title: '큐닷 AX — 파이프라인 데모',
  description: 'URL 하나로 전 상품 크롤링 → AI 분석 → 큐닷 제안서 정규화. 실제 실행 기록을 재생합니다.',
};

export default function DemoPage() {
  const stores = getDemoStores();

  if (stores.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-center text-ink-soft">
        실행 기록(run-log)이 아직 없습니다. <code>RUN_LOG=1 npm run crawl &lt;url&gt;</code> 로
        크롤하면 데모가 활성화됩니다.
      </main>
    );
  }

  return <DemoClient stores={stores} />;
}
