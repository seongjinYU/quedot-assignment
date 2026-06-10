// 네이버 스마트스토어 / 브랜드스토어 어댑터
// 정찰 결론: 인증 세션 컨텍스트에서 내부 JSON API를 직접 호출(결정적 추출).
//   - channelUid: 스토어 메인 __PRELOADED_STATE__.channel.channelUid
//   - 목록: 전체상품 SSR categoryProducts (1페이지 40) + page 버튼 클릭 가로채기(전수)
//   - 상세: GET /i/v2/channels/{uid}/products/{id}?withWindow=false
import type { BrowserSession } from '../crawler/browser.js';
import type { StoreAdapter, RawProduct, OptionCombo, ListOptions, PriceInfo } from './types.js';

export class NaverStoreAdapter implements StoreAdapter {
  readonly name = 'naver';
  private channelUid?: string;
  private channelNo?: string;
  private apiOrigin?: string; // same-origin 호출용 (smartstore vs brand)
  private apiPrefix?: string; // smartstore='i', brand='n'

  constructor(private session: BrowserSession) {}

  /** 내부 API base (예: https://brand.naver.com/n  또는  https://smartstore.naver.com/i) */
  private apiBase(): string {
    return `${this.apiOrigin}/${this.apiPrefix}`;
  }

  matches(url: string): boolean {
    return /smartstore\.naver\.com|brand\.naver\.com/.test(url);
  }

  /** 스토어 origin (쿼리/경로 제거) */
  private storeBase(url: string): string {
    const m = url.match(/https?:\/\/(?:m\.)?(smartstore|brand)\.naver\.com\/[^/?#]+/);
    if (!m) throw new Error(`네이버 스토어 URL 형식이 아님: ${url}`);
    return m[0].replace('m.', '');
  }

  private async ensureChannel(storeUrl: string): Promise<void> {
    if (this.channelUid) return;
    const base = this.storeBase(storeUrl);
    this.apiOrigin = new URL(base).origin; // smartstore.naver.com or brand.naver.com
    this.apiPrefix = base.includes('brand.naver.com') ? 'n' : 'i'; // brand는 /n/, smartstore는 /i/
    await this.session.goto(base);
    const pre = await this.session.preloadedState<any>();
    this.channelUid = pre?.channel?.channelUid;
    this.channelNo = String(pre?.channel?.id ?? pre?.channel?.channelNo ?? '');
    if (!this.channelUid) throw new Error('channelUid 추출 실패 (로그인/세션 확인 필요)');
  }

  /**
   * 가격 배치 조회 — product-benefits에 여러 상품을 한 번에 전달.
   * 응답: { [channelProductNo]: { totalDiscountResult.summary.totalPayAmount, productInfo.salePrice/baseFee/... } }
   */
  async fetchPrices(storeUrl: string, ids: string[]): Promise<Map<string, PriceInfo>> {
    await this.ensureChannel(storeUrl);
    const result = new Map<string, PriceInfo>();
    if (ids.length === 0) return result;

    const url = `${this.apiBase()}/v2/channels/${this.channelUid}/product-benefits`;
    // 큰 배치는 안전하게 청크 분할 (네이버 부하/매너)
    const CHUNK = 50;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const body = {
        products: chunk.map((id) => ({ id: String(id), channelNo: String(this.channelNo), purchaseQuantityInfo: {} })),
      };
      const res = await this.session.apiPost<Record<string, any>>(url, body);
      if (!res.ok || !res.body) {
        console.log(`  ⚠️ 가격 배치 실패(${res.status}) — 해당 청크 ${chunk.length}건 가격 공란 처리`);
        continue;
      }
      for (const id of chunk) {
        const e = res.body[id];
        if (!e) continue;
        const summary = e.totalDiscountResult?.summary;
        const pInfo = e.productInfo;
        result.set(String(id), {
          consumerPrice: pInfo?.salePrice ?? null, // 정가
          salePrice: summary?.totalPayAmount ?? pInfo?.salePrice ?? null, // 즉시할인 적용가
          deliveryFee: pInfo
            ? {
                base: pInfo.baseFee ?? undefined,
                freeOver: pInfo.productDeliveryDetailResponse?.freeConditionalAmount ?? undefined,
                type: pInfo.deliveryFeeType ?? undefined,
              }
            : null,
        });
      }
    }
    return result;
  }

  async listProductNos(storeUrl: string, opts?: ListOptions): Promise<string[]> {
    await this.ensureChannel(storeUrl);
    const base = this.storeBase(storeUrl);
    // 1페이지: 전체상품 SSR (__PRELOADED_STATE__.categoryProducts)
    await this.session.goto(`${base}/category/ALL?st=POPULAR`);
    const pre = await this.session.preloadedState<any>();
    const cp = pre?.categoryProducts?.A ?? pre?.categoryProducts ?? {};
    const first: any[] = cp.simpleProducts ?? [];
    const totalCount: number = cp.totalCount ?? first.length;
    const pageSize: number = cp.pageSize ?? 40;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    const ids = new Map<string, boolean>(); // 순서 유지 + 중복 제거
    first.forEach((p) => ids.set(String(p.id ?? p.productNo), true));
    console.log(`  목록 page 1: ${first.length}건 (전체 ${totalCount}개 / ${totalPages}페이지)`);

    // 2~N페이지: 페이지 버튼 클릭 → 목록 XHR 가로채기 (직접 fetch는 429)
    for (let page = 2; page <= totalPages; page++) {
      await this.session.scrollBottom(4); // 페이지네이션 노출
      const body = await this.session.captureJsonOnClick<any>(String(page), 'categories/ALL/products');
      const more: any[] = body?.simpleProducts ?? body?.A?.simpleProducts ?? [];
      if (more.length === 0) {
        console.log(`  ⚠️ page ${page} 수집 실패 — 가로채기 응답 없음(중단)`);
        break;
      }
      more.forEach((p) => ids.set(String(p.id ?? p.productNo), true));
      console.log(`  목록 page ${page}: +${more.length}건 (누적 ${ids.size})`);
    }

    // 목록은 항상 전수 반환 (상세 처리 대상 제한은 호출부에서)
    return [...ids.keys()].filter(Boolean);
  }

  async fetchProduct(storeUrl: string, id: string): Promise<RawProduct> {
    await this.ensureChannel(storeUrl);
    const base = this.storeBase(storeUrl);
    const url = `${this.apiBase()}/v2/channels/${this.channelUid}/products/${id}?withWindow=false`;
    const res = await this.session.apiGet<any>(url);
    if (!res.ok || !res.body) throw new Error(`상세 조회 실패(${res.status}): ${id}`);
    const d = res.body;

    const images: string[] = (d.productImages ?? []).map((i: any) => i.url).filter(Boolean);
    const repImg =
      (d.productImages ?? []).find((i: any) => i.imageType === 'REPRESENTATIVE')?.url ?? images[0] ?? null;

    // 옵션 파싱: COMBINATION형(optionCombinations) / SIMPLE형(options에 직접)
    const rawCombos: any[] = d.optionCombinations ?? [];
    const optionDefs: any[] = d.options ?? [];
    let optionAxes: string[] = optionDefs.map((o) => o.groupName).filter(Boolean);
    let optionCombos: OptionCombo[];

    if (rawCombos.length > 0) {
      // COMBINATION: optionName1/2/3 = 각 축의 값, price = 추가금
      optionCombos = rawCombos.map((c) => ({
        names: [c.optionName1, c.optionName2, c.optionName3].filter(Boolean),
        addPrice: c.price ?? 0,
        stock: c.stockQuantity ?? undefined,
        soldOut: c.usable === false || c.stockQuantity === 0,
      }));
    } else {
      // SIMPLE: options[].name 자체가 선택지 (1축)
      const simple = optionDefs.filter((o) => o.optionType === 'SIMPLE' && o.name);
      optionCombos = simple.map((o) => ({
        names: [o.name],
        addPrice: o.price ?? 0,
        stock: o.stockQuantity ?? undefined,
        soldOut: o.usable === false,
      }));
      optionAxes = [...new Set(simple.map((o) => o.groupName).filter(Boolean))];
    }

    return {
      productNo: String(d.id ?? id),
      brandName: d.naverShoppingSearchInfo?.brandName ?? d.channel?.channelName ?? null,
      name: d.name ?? null,
      representativeImage: repImg,
      images,
      consumerPrice: d.salePrice ?? null, // 정가(소비자가)
      salePrice: null, // 즉시할인 적용가 → product-benefits로 보강 예정
      deliveryFee: null, // product-benefits로 보강 예정
      optionAxes,
      optionCombos,
      // 상품 단위 품절: productStatusType이 SALE이 아니면 구매불가(OUTOFSTOCK/SUSPENSION 등)
      // — 옵션 없는 단일상품도 잡힘(옵션 조합 usable만으론 놓침).
      soldOut: !!(d.productStatusType && d.productStatusType !== 'SALE'),
      categoryPath: d.category?.wholeCategoryName ?? null,
      sellerTags: (d.seoInfo?.sellerTags ?? []).map((t: any) => t.text).filter(Boolean),
      // 상세 응답에 텍스트 본문이 있으면 사용(방어용). 한국 네이버 상세는 거의 이미지라 보통 null.
      // ※ 별도 contents API 호출은 하지 않음 — 건지는 게 SEO 키워드뿐이라 비용 대비 가치 없음(설계 결정).
      detailText: this.extractInlineDetailText(d),
      naverMid: d.epInfo?.syncNvMid ?? null,
      sourceUrl: d.productUrl ?? `${base}/products/${id}`,
    };
  }

  /**
   * 상세 응답에 포함된 "문장형 본문"만 추출. 추가 네트워크 호출 없음.
   * ⚠️ detailContents.detailContentText는 네이버의 SEO 키워드 나열 필드(셀러태그와 중복)이므로 사용하지 않음.
   *    실제 검증 결과 한국 네이버 상세는 본문이 이미지라 문장 텍스트가 거의 없음(REFLECTION.md 6번 참조).
   * 여기서는 다른 브랜드몰이 문장형 상세(detailContent 단수 등)를 줄 경우를 위한 방어 로직만 유지.
   */
  private extractInlineDetailText(d: any): string | null {
    // SEO 키워드 필드(detailContentText)는 의도적으로 제외. 문장형 본문 필드만 후보.
    const raw: string = (d.detailContent ?? '').toString();
    if (!raw) return null;
    const text = raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/[​]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length >= 30 ? text.slice(0, 2000) : null;
  }
}
