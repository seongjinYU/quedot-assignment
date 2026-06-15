// 로컬 라이브 크롤 SSE 엔드포인트 — 실제 크롤을 spawn해 stdout 센티넬 이벤트를 브라우저로 중계.
// Vercel(서버리스)에선 ENABLE_LIVE_CRAWL 미설정 → 503 → UI가 재생으로 폴백.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_PREFIX = '__QD_EVENT__'; // src/normalize/runReporter.ts 와 동일
const STREAM_DONE = '__QD_DONE__';

const STORE_URLS: Record<string, string> = {
  kefii: 'https://brand.naver.com/kefii',
  phytonutri: 'https://smartstore.naver.com/phytonutri',
  happylandmall: 'https://m.happylandmall.com/',
};

const enabled = () => process.env.ENABLE_LIVE_CRAWL === '1';

export async function GET(req: Request) {
  const url = new URL(req.url);

  // 상태 확인 — UI가 라이브 가능 여부를 판단
  if (url.searchParams.get('status') === '1') {
    return Response.json({ enabled: enabled() });
  }

  if (!enabled()) {
    return new Response('live crawl disabled', { status: 503 });
  }

  const slug = url.searchParams.get('store') ?? '';
  const storeUrl = STORE_URLS[slug];
  if (!storeUrl) return new Response('unknown store', { status: 400 });
  const limit = Math.max(1, Math.min(12, Number(url.searchParams.get('limit') ?? '6')));

  const repoRoot = path.resolve(process.cwd(), '..');
  const liveOut = path.join(repoRoot, 'output', '.live');

  const enc = new TextEncoder();
  let child: ChildProcessWithoutNullStreams | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => controller.enqueue(enc.encode(s));
      // 크롤 spawn — 최저가는 네이버 OpenAPI + 에누리(쿠팡 등 오픈마켓) 실조회.
      //   에누리는 Playwright DOM 스크랩이라 다소 느리지만 채움률이 올라간다.
      //   ENABLE_OCR=true: 근거 부족(셀러태그·본문 없음) 상품의 상세이미지 OCR 보강.
      //   네이버는 셀러태그 있어 자동 스킵 → 사실상 godomall(상세 텍스트 부족)에만 작동.
      child = spawn('npm', ['run', 'crawl', storeUrl, String(limit), 'enuri'], {
        cwd: repoRoot,
        env: { ...process.env, RUN_LOG: '1', RUN_STREAM: '1', OUTPUT_DIR: liveOut, ENABLE_OCR: 'true' },
      });

      let buf = '';
      let finished = false;
      let stderrTail = '';

      const finishDone = (totals?: unknown) => {
        if (finished) return;
        finished = true;
        send(`event: done\ndata: ${JSON.stringify({ totals })}\n\n`);
        controller.close();
      };
      const fail = (message: string) => {
        if (finished) return;
        finished = true;
        send(`event: failed\ndata: ${JSON.stringify({ message })}\n\n`);
        controller.close();
      };

      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.startsWith(STREAM_PREFIX)) {
            send(`data: ${line.slice(STREAM_PREFIX.length)}\n\n`);
          } else if (line.startsWith(STREAM_DONE)) {
            let totals: unknown;
            try { totals = JSON.parse(line.slice(STREAM_DONE.length)).totals; } catch {}
            finishDone(totals);
          }
        }
      });
      child.stderr.on('data', (c: Buffer) => { stderrTail = (stderrTail + c.toString()).slice(-600); });
      child.on('error', (e) => fail(`크롤 프로세스 시작 실패: ${e.message}`));
      child.on('close', (code) => {
        if (code === 0) finishDone();
        else fail(`크롤 종료 코드 ${code}${stderrTail ? ` · ${stderrTail.split('\n').slice(-2).join(' ')}` : ''}`);
      });
    },
    cancel() {
      child?.kill('SIGTERM');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
