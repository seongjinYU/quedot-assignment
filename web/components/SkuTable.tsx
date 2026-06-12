"use client";

import { useMemo, useState } from "react";
import type {
  NormalizedProduct,
  ProductField,
  FieldProvenance,
} from "@/lib/types";
import { TABLE_FIELDS, DETAIL_FIELDS } from "@/lib/types";
import { getFieldDisplay } from "@/lib/provenance";
import { MethodDot, MethodBadge } from "./ProvenanceBadge";

function rowId(p: NormalizedProduct) {
  return `${p.meta.productNo}-${p.meta.optionIndex ?? 0}`;
}

function fmtValue(field: ProductField, p: NormalizedProduct): string {
  const v = p.data[field] as unknown;
  if (v == null) return "—";
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    if (field === "hashtags") return v.map((t) => `#${t}`).join(" ");
    return v.join(", ");
  }
  if (typeof v === "number") {
    if (field === "discount_rate") return `${v}%`;
    return `${v.toLocaleString("ko-KR")}원`;
  }
  return String(v);
}

/** storeUrl + productNo 로 "상품 페이지" 직링크를 구성. 못 만들면 스토어 홈으로 폴백. */
function productUrl(meta: NormalizedProduct["meta"]): {
  href: string;
  isProduct: boolean;
} {
  const raw = meta.storeUrl ?? "";
  const base = raw.replace(/\/+$/, "");
  const no = meta.productNo;
  if (base && no) {
    if (base.includes("naver.com")) {
      return { href: `${base}/products/${no}`, isProduct: true };
    }
    if (/happylandmall|godomall|nhncommerce/.test(base)) {
      return {
        href: `${base}/goods/goods_view.php?goodsNo=${no}`,
        isProduct: true,
      };
    }
  }
  return { href: raw || "#", isProduct: false };
}

interface Row {
  id: string;
  p: NormalizedProduct;
  hasAi: boolean;
  hasEmpty: boolean;
  hasWarn: boolean;
  recoveredFields: Set<string>;
  soldOut: boolean;
  categories: string[];
  search: string;
}

function buildRow(p: NormalizedProduct): Row {
  const provs = Object.values(p.provenance) as FieldProvenance[];
  const recovered = new Set((p.meta.recovered ?? []).map((r) => r.field));
  return {
    id: rowId(p),
    p,
    hasAi: provs.some((pr) => pr.method === "ai" || pr.method === "ai-recovery"),
    hasEmpty: provs.some((pr) => pr.method === "empty"),
    hasWarn: (p.meta.issues ?? []).some((i) => i.level === "warn"),
    recoveredFields: recovered,
    soldOut: !!p.meta.soldOut,
    categories: p.data.category_group ?? [],
    search: `${p.data.brand_name ?? ""} ${p.data.name ?? ""} ${
      p.data.option1 ?? ""
    } ${p.data.option2 ?? ""}`.toLowerCase(),
  };
}

function Chip({
  active,
  onClick,
  dot,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-ink bg-ink text-paper shadow-[2px_2px_0_0_var(--color-ink)]"
          : "border-ink/25 bg-white text-ink hover:border-ink hover:bg-stone-50"
      }`}
    >
      {/* 체크박스 — 클릭 토글임을 명확히 */}
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
          active ? "border-paper/70" : "border-ink/40 bg-white"
        }`}
      >
        {active ? (
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={3.5}
          >
            <path d="M5 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      {dot ? <span className={`h-2 w-2 rounded-full ${dot}`} /> : null}
      {children}
    </button>
  );
}

export function SkuTable({ products }: { products: NormalizedProduct[] }) {
  const rows = useMemo(() => products.map(buildRow), [products]);

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const c of r.categories) s.add(c);
    return Array.from(s).sort();
  }, [rows]);

  const [query, setQuery] = useState("");
  const [onlyRecovered, setOnlyRecovered] = useState(false);
  const [onlyAi, setOnlyAi] = useState(false);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [onlySoldout, setOnlySoldout] = useState(false);
  const [category, setCategory] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyRecovered && r.recoveredFields.size === 0) return false;
      if (onlyAi && !r.hasAi) return false;
      if (onlyEmpty && !r.hasEmpty) return false;
      if (onlyWarn && !r.hasWarn) return false;
      if (onlySoldout && !r.soldOut) return false;
      if (category && !r.categories.includes(category)) return false;
      if (q && !r.search.includes(q)) return false;
      return true;
    });
  }, [
    rows,
    query,
    onlyRecovered,
    onlyAi,
    onlyEmpty,
    onlyWarn,
    onlySoldout,
    category,
  ]);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalRecovered = rows.filter((r) => r.recoveredFields.size > 0).length;
  const totalWarn = rows.filter((r) => r.hasWarn).length;

  return (
    <section className="space-y-3">
      {/* 검색(왼쪽) + 필터·카운트(오른쪽) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 검색 — 왼쪽 */}
        <div className="relative w-full sm:w-80">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-soft"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="상품명 · 브랜드 · 옵션 검색"
            className="w-full border-2 border-ink bg-white py-2.5 pl-11 pr-3 text-sm text-ink outline-none placeholder:text-ink-soft focus:bg-amber-50/40"
            style={{ boxShadow: "3px 3px 0 0 var(--color-ink)" }}
          />
        </div>

        {/* 필터 + 카운트 — 오른쪽 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-ink-soft">
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M3 5h18l-7 8v6l-4-2v-4z" strokeLinejoin="round" />
            </svg>
            필터
          </span>
          <Chip
            active={onlyRecovered}
            dot="bg-red-500"
            onClick={() => setOnlyRecovered((v) => !v)}
          >
            확인필요{totalRecovered > 0 ? ` ${totalRecovered}` : ""}
          </Chip>
          <Chip
            active={onlyAi}
            dot="bg-violet-500"
            onClick={() => setOnlyAi((v) => !v)}
          >
            AI 포함
          </Chip>
          <Chip
            active={onlyEmpty}
            dot="bg-stone-400"
            onClick={() => setOnlyEmpty((v) => !v)}
          >
            공란 포함
          </Chip>
          <Chip
            active={onlyWarn}
            dot="bg-amber-500"
            onClick={() => setOnlyWarn((v) => !v)}
          >
            검수 권장{totalWarn > 0 ? ` ${totalWarn}` : ""}
          </Chip>
          <Chip active={onlySoldout} onClick={() => setOnlySoldout((v) => !v)}>
            품절
          </Chip>
          {allCategories.length > 0 ? (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="border border-rule bg-panel px-2 py-1.5 font-mono text-[11px] text-ink-soft outline-none focus:border-ink"
            >
              <option value="">전체 카테고리</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : null}
          <span className="ml-1 font-mono text-xs tnum text-ink-soft">
            {filtered.length === rows.length
              ? `전체 ${rows.length.toLocaleString("ko-KR")}건`
              : `${filtered.length.toLocaleString("ko-KR")} / ${rows.length.toLocaleString("ko-KR")}건`}
          </span>
        </div>
      </div>

      {/* 원장 테이블 */}
      <div className="overflow-x-auto border border-rule bg-panel">
        <table className="w-full min-w-[1780px] table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: 70 }} />
            <col style={{ width: 66 }} />
            <col style={{ width: 300 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 78 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 340 }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-ink text-left font-mono text-[11px] uppercase tracking-[0.08em] text-paper">
            <tr>
              <th className="border-r border-white/10 px-3 py-2.5 font-medium">
                상세 보기
              </th>
              <th className="border-r border-white/10 px-3 py-2.5 font-medium">
                이미지
              </th>
              <th className="border-r border-white/10 px-3 py-2.5 font-medium">
                상품명 / 브랜드
              </th>
              {TABLE_FIELDS.map((f) => (
                <th
                  key={f.key}
                  className="border-r border-white/10 px-3 py-2.5 font-medium"
                >
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {filtered.map((r) => (
              <FragmentRow
                key={r.id}
                row={r}
                isOpen={open.has(r.id)}
                onToggle={() => toggle(r.id)}
              />
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={3 + TABLE_FIELDS.length}
                  className="px-3 py-12 text-center font-mono text-sm text-ink-soft"
                >
                  조건에 맞는 행이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cell({
  field,
  prov,
  recovered,
  children,
}: {
  field: ProductField;
  prov: FieldProvenance;
  recovered: boolean;
  children: React.ReactNode;
}) {
  const m = getFieldDisplay(field, prov);
  const tip = [m.label, prov.source, prov.reason].filter(Boolean).join(" · ");
  return (
    <td
      className={`border-r border-rule px-3 py-2.5 align-top ${m.tint} ${
        recovered ? "ring-1 ring-inset ring-red-300" : ""
      }`}
      title={tip}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-1">
          <MethodDot method={prov.method} field={field} />
        </span>
        <div className="min-w-0">{children}</div>
      </div>
    </td>
  );
}

function FragmentRow({
  row,
  isOpen,
  onToggle,
}: {
  row: Row;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { p } = row;
  return (
    <>
      <tr
        className="cursor-pointer transition-colors hover:bg-ink/[0.03]"
        onClick={onToggle}
      >
        {/* 상태 */}
        <td className="border-r border-rule px-3 py-2.5 align-top">
          <div className="flex flex-col items-start gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              className={`h-6 w-6 text-ink transition-transform ${
                isOpen ? "" : "-rotate-90"
              }`}
            >
              <path
                d="M6 9l6 6 6-6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {row.recoveredFields.size > 0 ? (
              <span className="border border-red-200 bg-red-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-red-600">
                확인필요
              </span>
            ) : null}
            {row.soldOut ? (
              <span className="border border-rule bg-paper px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
                품절
              </span>
            ) : null}
            {p.meta.bundle ? (
              <span className="border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-indigo-600">
                묶음
              </span>
            ) : null}
          </div>
        </td>

        {/* 이미지 */}
        <td className="border-r border-rule px-3 py-2.5 align-top">
          {p.data.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.data.image_url}
              alt=""
              loading="lazy"
              className="h-12 w-12 border border-rule bg-panel object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center border border-rule font-mono text-[10px] text-ink-soft">
              none
            </div>
          )}
        </td>

        {/* 상품명 / 브랜드 */}
        <td className="border-r border-rule px-3 py-2.5 align-top">
          <div className="flex items-start gap-1.5">
            <span className="mt-1">
              <MethodDot method={p.provenance.name.method} />
            </span>
            <div className="min-w-0">
              <div className="break-keep text-sm leading-snug text-ink">
                {p.data.name ?? "—"}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-ink-soft">
                {p.data.brand_name ?? "—"}
              </div>
            </div>
          </div>
        </td>

        {/* 데이터 필드 */}
        {TABLE_FIELDS.map((f) => {
          const prov = p.provenance[f.key];
          const recovered = row.recoveredFields.has(f.key);
          const numeric =
            f.key === "consumer_price" ||
            f.key === "sales_price" ||
            f.key === "lowest_price" ||
            f.key === "discount_rate";
          return (
            <Cell key={f.key} field={f.key} prov={prov} recovered={recovered}>
              <span
                className={
                  f.key === "usp"
                    ? "line-clamp-4 break-keep text-[13px] leading-snug text-ink"
                    : f.key === "hashtags"
                      ? "line-clamp-3 break-keep font-mono text-[12px] leading-snug text-ink-soft"
                      : numeric
                        ? "font-mono text-sm tnum text-ink"
                        : "break-keep text-sm text-ink"
                }
              >
                {fmtValue(f.key, p)}
              </span>
            </Cell>
          );
        })}
      </tr>

      {isOpen ? (
        <tr className="bg-paper">
          <td colSpan={3 + TABLE_FIELDS.length} className="px-3 py-4">
            <DetailPanel p={p} recoveredFields={row.recoveredFields} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DetailPanel({
  p,
  recoveredFields,
}: {
  p: NormalizedProduct;
  recoveredFields: Set<string>;
}) {
  const fields = [
    ...TABLE_FIELDS,
    ...DETAIL_FIELDS,
    { key: "image_url" as ProductField, label: "이미지" },
  ];
  const link = productUrl(p.meta);
  return (
    <div className="space-y-3">
      {/* 상품 헤더 (이름 + 상품 페이지 직링크) */}
      <div className="flex items-start justify-between gap-4 border-b border-rule pb-2">
        <div className="min-w-0">
          <div className="break-keep text-[15px] font-medium leading-snug text-ink">
            {p.data.name ?? "—"}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-soft">
            {p.data.brand_name ?? "—"} · 상품번호 {p.meta.productNo}
          </div>
        </div>
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-paper transition hover:bg-ink/85"
        >
          {link.isProduct ? "상품 페이지 ↗" : "스토어 ↗"}
        </a>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 필드별 출처 */}
      <div className="border border-rule bg-panel">
        <div className="border-b border-rule px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
          Provenance · 필드별 출처
        </div>
        <ul className="px-3 py-2">
          {fields.map((f) => {
            const prov = p.provenance[f.key];
            if (!prov) return null;
            const evidence = prov.source || prov.reason || "";
            return (
              <li
                key={f.key}
                className={`flex items-start gap-2 py-1 text-xs ${
                  recoveredFields.has(f.key) ? "bg-red-50/70" : ""
                }`}
              >
                <span className="w-20 shrink-0 font-mono text-ink-soft">
                  {f.label}
                </span>
                <MethodBadge prov={prov} field={f.key} />
                {evidence ? (
                  <span className="text-ink-soft">{evidence}</span>
                ) : null}
                {prov.fetchedAt ? (
                  <span className="font-mono text-[10px] text-ink-soft">
                    · 수집 {new Date(prov.fetchedAt).toLocaleString("ko-KR")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* 원본 메타 */}
      <div className="border border-rule bg-panel">
        <div className="border-b border-rule px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
          Source Meta · 원본 추적
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1 px-3 py-2 text-xs">
          <dt className="text-ink-soft">상품번호</dt>
          <dd className="font-mono tnum text-ink">{p.meta.productNo}</dd>

          {p.meta.naverMid != null ? (
            <>
              <dt className="text-ink-soft">네이버 MID</dt>
              <dd className="font-mono tnum text-ink">
                {String(p.meta.naverMid)}
              </dd>
            </>
          ) : null}

          {p.meta.optionAxes && p.meta.optionAxes.length > 0 ? (
            <>
              <dt className="text-ink-soft">옵션 축</dt>
              <dd className="text-ink">
                {p.meta.optionAxes.join(" × ")}
                {p.meta.optionAxisCount && p.meta.optionAxisCount > 2 ? (
                  <span className="ml-1 text-teal-600">
                    ({p.meta.optionAxisCount}축 → 2칸 압축)
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}

          {p.meta.optionTotal ? (
            <>
              <dt className="text-ink-soft">옵션 조합</dt>
              <dd className="font-mono tnum text-ink">
                {(p.meta.optionIndex ?? 0) + 1} / {p.meta.optionTotal}
              </dd>
            </>
          ) : null}

          {p.meta.bundle ? (
            <>
              <dt className="text-ink-soft">묶음</dt>
              <dd className="text-ink">
                {p.meta.bundle.quantity}개 · 결제{" "}
                {p.meta.bundle.total.toLocaleString("ko-KR")}원 ·{" "}
                {p.meta.bundle.basis}
              </dd>
            </>
          ) : null}

          {p.meta.note ? (
            <>
              <dt className="text-ink-soft">비고</dt>
              <dd className="text-ink">{p.meta.note}</dd>
            </>
          ) : null}

          <dt className="text-ink-soft">수집 시각</dt>
          <dd className="font-mono tnum text-ink">
            {new Date(p.meta.crawledAt).toLocaleString("ko-KR")}
          </dd>

          <dt className="text-ink-soft">원본</dt>
          <dd className="truncate">
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="text-ink underline decoration-ink-soft underline-offset-2 hover:decoration-ink"
            >
              {link.isProduct ? "상품 페이지 열기 ↗" : "스토어 열기 ↗"}
            </a>
          </dd>
        </dl>
      </div>
      </div>
    </div>
  );
}
