// 상세 이미지 OCR (조건부 보강) — 셀러태그·본문텍스트가 없어 근거가 부족한 상품 전용.
// 핵심 교훈(검증): 긴 상세 이미지를 통째로 비전모델에 넣으면 다운스케일되어 환각(예: 유아 사이즈
//   80/90/100/110 → "S/M/L")이 발생. → 세로 스트립으로 잘라 고해상도로 OCR해야 정확.
// 산출 detailText는 그대로 신뢰하지 않고, 최종 USP/hashtags는 enricher+validate 관문을 거친다.
import OpenAI from 'openai';
// sharp는 타입을 동봉하지만 일부 moduleResolution에서 exports 경로 해석이 안 됨(알려진 이슈).
// 사용 API(metadata/extract/jpeg/toBuffer)가 적어 영향 미미 → 국소 무시.
// @ts-ignore
import sharp from 'sharp';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface OcrOptions {
  stripHeight?: number; // 스트립 1개 높이(px) — 글씨 가독 해상도 (기본 1400)
  overlap?: number; // 스트립 간 겹침(px) — 경계 글자 잘림 방지 (기본 120)
  maxStrips?: number; // 이미지당 최대 스트립 수 — 비용 상한 (기본 12)
  maxChars?: number; // detailText 최대 길이 (기본 4000)
  ocrWidth?: number; // 스트립 OCR 전송 폭(px) — 토큰(=타일수) 절감 (기본 512)
  concurrency?: number; // 동시 OCR 호출 수 — TPM 보호 (기본 3)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OcrReader {
  constructor(
    private client: OpenAI,
    private model = 'gpt-4o-mini',
    private opts: OcrOptions = {},
  ) {}

  /** 여러 상세 이미지에서 텍스트 추출 후 결합. 의미있는 텍스트가 없으면 null. */
  async extractText(imageUrls: string[]): Promise<string | null> {
    const parts: string[] = [];
    for (const url of imageUrls) {
      try {
        const t = await this.ocrImage(url);
        if (t) parts.push(t);
      } catch (e: any) {
        console.log(`  ⚠️ OCR 이미지 실패(...${url.slice(-28)}): ${e.message}`);
      }
    }
    const combined = dedupeLines(parts.join('\n')).trim();
    // 글자(공백 제외) 10자 미만이면 텍스트 없음으로 판단 → 지어내지 않고 null
    if (combined.replace(/\s/g, '').length < 10) return null;
    const max = this.opts.maxChars ?? 4000;
    return combined.length > max ? combined.slice(0, max) : combined;
  }

  /** 이미지 1장: 다운로드 → 세로 스트립 분할 → 각 스트립 OCR(병렬) → 텍스트 결합 */
  private async ocrImage(url: string): Promise<string | null> {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`다운로드 ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return null;

    const stripH = this.opts.stripHeight ?? 1400;
    const overlap = this.opts.overlap ?? 120;
    const maxStrips = this.opts.maxStrips ?? 12;

    // 세로 스트립 좌표 계산 (겹침 포함)
    const strips: { top: number; height: number }[] = [];
    if (H <= stripH) {
      strips.push({ top: 0, height: H });
    } else {
      let top = 0;
      while (top < H && strips.length < maxStrips) {
        const height = Math.min(stripH, H - top);
        strips.push({ top, height });
        if (top + height >= H) break;
        top += stripH - overlap;
      }
    }

    // 각 스트립을 잘라 OCR. 동시성 제한 + 512px 리사이즈로 TPM(토큰) 보호.
    const ocrWidth = Math.min(W, this.opts.ocrWidth ?? 512);
    const conc = this.opts.concurrency ?? 3;
    const texts: string[] = [];
    for (let i = 0; i < strips.length; i += conc) {
      const batch = strips.slice(i, i + conc);
      const out = await Promise.all(
        batch.map(async (s) => {
          const jpg = await sharp(buf)
            .extract({ left: 0, top: s.top, width: W, height: s.height })
            .resize({ width: ocrWidth }) // 폭 축소 = 비전 타일 수 감소 = 토큰 절감
            .jpeg({ quality: 90 })
            .toBuffer();
          return this.ocrStrip(jpg);
        }),
      );
      texts.push(...out);
    }
    return texts.filter(Boolean).join('\n');
  }

  /** 스트립 1개 OCR — 보이는 텍스트만 그대로 추출(추측 금지). 429는 백오프 재시도. */
  private async ocrStrip(jpg: Buffer, attempt = 0): Promise<string> {
    const b64 = jpg.toString('base64');
    try {
      return await this.callOcr(b64);
    } catch (e: any) {
      if (e?.status === 429 && attempt < 4) {
        await sleep(1500 * (attempt + 1)); // TPM 회복 대기 후 재시도
        return this.ocrStrip(jpg, attempt + 1);
      }
      throw e;
    }
  }

  private async callOcr(b64: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            '이미지에 적힌 한국어 텍스트를 보이는 그대로 옮긴다. 추측·번역·창작 금지. ' +
            '숫자·퍼센트·단위(사이즈 80/90/100/110, 혼용률 면87% 등)를 정확히. ' +
            '텍스트가 없는(상품 사진뿐인) 이미지면 빈 문자열만 반환한다.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '이 이미지의 텍스트를 그대로 추출(순수 텍스트, 줄바꿈 유지). 텍스트 없으면 빈 문자열.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } },
          ],
        },
      ],
    });
    // 모델이 가끔 ```로 감싸는 노이즈 제거
    return (res.choices[0].message.content ?? '').replace(/```[a-z]*/gi, '').trim();
  }
}

/** 스트립 겹침 중복 줄 제거 + 빈 줄/노이즈("빈 문자열" 지시 에코) 정리 */
function dedupeLines(s: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split('\n')) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    if (/^["'(]?빈\s*문자열["'.)]?$/.test(t)) continue; // 사진뿐 스트립의 지시 에코 제거
    seen.add(t);
    out.push(t);
  }
  return out.join('\n');
}
