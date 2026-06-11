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

interface Row {
  id: string;
  p: NormalizedProduct;
  hasAi: boolean;
  hasEmpty: boolean;
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
    hasAi: provs.some(
      (pr) => pr.method === "ai" || pr.method === "ai-recovery"
    ),
    hasEmpty: provs.some((pr) => pr.method === "empty"),
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
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
        active
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
      }`}
    >
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
  const [onlySoldout, setOnlySoldout] = useState(false);
  const [category, setCategory] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyRecovered && r.recoveredFields.size === 0) return false;
      if (onlyAi && !r.hasAi) return false;
      if (onlyEmpty && !r.hasEmpty) return false;
      if (onlySoldout && !r.soldOut) return false;
      if (category && !r.categories.includes(category)) return false;
      if (q && !r.search.includes(q)) return false;
      return true;
    });
  }, [rows, query, onlyRecovered, onlyAi, onlyEmpty, onlySoldout, category]);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalRecovered = rows.filter((r) => r.recoveredFields.size > 0).length;

  return (
    <section className="space-y-3">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품명·브랜드·옵션 검색"
          className="w-56 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-400"
        />
        <Chip active={onlyRecovered} onClick={() => setOnlyRecovered((v) => !v)}>
          🔴 확인필요{totalRecovered > 0 ? ` ${totalRecovered}` : ""}
        </Chip>
        <Chip active={onlyAi} onClick={() => setOnlyAi((v) => !v)}>
          🟣 AI 포함
        </Chip>
        <Chip active={onlyEmpty} onClick={() => setOnlyEmpty((v) => !v)}>
          ⚪ 공란 포함
        </Chip>
        <Chip active={onlySoldout} onClick={() => setOnlySoldout((v) => !v)}>
          품절
        </Chip>
        {allCategories.length > 0 ? (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-slate-400"
          >
            <option value="">전체 카테고리</option>
            {allCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">
          {filtered.length.toLocaleString("ko-KR")} / {rows.length.toLocaleString("ko-KR")}행
        </span>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 font-medium">이미지</th>
              <th className="px-3 py-2 font-medium">상품명 / 브랜드</th>
              {TABLE_FIELDS.map((f) => (
                <th key={f.key} className="px-3 py-2 font-medium">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const { p } = r;
              const isOpen = open.has(r.id);
              return (
                <FragmentRow
                  key={r.id}
                  row={r}
                  isOpen={isOpen}
                  onToggle={() => toggle(r.id)}
                />
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={3 + TABLE_FIELDS.length}
                  className="px-3 py-10 text-center text-sm text-slate-400"
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
      className={`px-3 py-2 align-top ${m.tint} ${
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
        className="cursor-pointer hover:bg-slate-50/60"
        onClick={onToggle}
      >
        {/* 상태 */}
        <td className="px-3 py-2 align-top">
          <div className="flex flex-col items-start gap-1">
            <span className="text-slate-300">{isOpen ? "▾" : "▸"}</span>
            {row.recoveredFields.size > 0 ? (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 ring-1 ring-inset ring-red-200">
                확인필요
              </span>
            ) : null}
            {row.soldOut ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                품절
              </span>
            ) : null}
            {p.meta.bundle ? (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 ring-1 ring-inset ring-indigo-200">
                묶음
              </span>
            ) : null}
          </div>
        </td>

        {/* 이미지 */}
        <td className="px-3 py-2 align-top">
          {p.data.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.data.image_url}
              alt=""
              loading="lazy"
              className="h-12 w-12 rounded border border-slate-200 bg-white object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded border border-slate-200 text-[10px] text-slate-300">
              없음
            </div>
          )}
        </td>

        {/* 상품명 / 브랜드 */}
        <td className="px-3 py-2 align-top">
          <div className="flex items-start gap-1.5">
            <span className="mt-1">
              <MethodDot method={p.provenance.name.method} />
            </span>
            <div className="min-w-0 max-w-[16rem]">
              <div className="line-clamp-2 text-slate-800">
                {p.data.name ?? "—"}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {p.data.brand_name ?? "—"}
              </div>
            </div>
          </div>
        </td>

        {/* 데이터 필드 */}
        {TABLE_FIELDS.map((f) => {
          const prov = p.provenance[f.key];
          const recovered = row.recoveredFields.has(f.key);
          const isUsp = f.key === "usp";
          return (
            <Cell key={f.key} field={f.key} prov={prov} recovered={recovered}>
              <span
                className={
                  isUsp
                    ? "line-clamp-3 max-w-[18rem] text-[13px] text-slate-700"
                    : f.key === "hashtags"
                      ? "line-clamp-2 max-w-[12rem] text-[12px] text-slate-500"
                      : "tabular-nums text-slate-700"
                }
              >
                {fmtValue(f.key, p)}
              </span>
            </Cell>
          );
        })}
      </tr>

      {isOpen ? (
        <tr className="bg-slate-50/60">
          <td colSpan={3 + TABLE_FIELDS.length} className="px-3 py-3">
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
  const fields = [...TABLE_FIELDS, ...DETAIL_FIELDS, { key: "image_url" as ProductField, label: "이미지" }];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 필드별 출처 */}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-slate-500">
          필드별 출처(provenance)
        </div>
        <ul className="space-y-1.5">
          {fields.map((f) => {
            const prov = p.provenance[f.key];
            if (!prov) return null;
            const evidence = prov.source || prov.reason || "";
            return (
              <li
                key={f.key}
                className={`flex items-start gap-2 rounded px-1 py-0.5 text-xs ${
                  recoveredFields.has(f.key) ? "bg-red-50" : ""
                }`}
              >
                <span className="w-20 shrink-0 text-slate-400">{f.label}</span>
                <MethodBadge prov={prov} field={f.key} />
                {evidence ? (
                  <span className="text-slate-500">{evidence}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* 원본 메타 */}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-slate-500">
          원본 추적 메타
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-xs">
          <dt className="text-slate-400">상품번호</dt>
          <dd className="tabular-nums text-slate-700">{p.meta.productNo}</dd>

          {p.meta.naverMid != null ? (
            <>
              <dt className="text-slate-400">네이버 MID</dt>
              <dd className="tabular-nums text-slate-700">
                {String(p.meta.naverMid)}
              </dd>
            </>
          ) : null}

          {p.meta.optionAxes && p.meta.optionAxes.length > 0 ? (
            <>
              <dt className="text-slate-400">옵션 축</dt>
              <dd className="text-slate-700">
                {p.meta.optionAxes.join(" × ")}
                {p.meta.optionAxisCount && p.meta.optionAxisCount > 2 ? (
                  <span className="ml-1 text-red-500">
                    ({p.meta.optionAxisCount}축 — 큐닷 2칸 제약)
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}

          {p.meta.optionTotal ? (
            <>
              <dt className="text-slate-400">옵션 조합</dt>
              <dd className="tabular-nums text-slate-700">
                {(p.meta.optionIndex ?? 0) + 1} / {p.meta.optionTotal}
              </dd>
            </>
          ) : null}

          {p.meta.bundle ? (
            <>
              <dt className="text-slate-400">묶음</dt>
              <dd className="text-slate-700">
                {p.meta.bundle.quantity}개 · 결제{" "}
                {p.meta.bundle.total.toLocaleString("ko-KR")}원 ·{" "}
                {p.meta.bundle.basis}
              </dd>
            </>
          ) : null}

          {p.meta.note ? (
            <>
              <dt className="text-slate-400">비고</dt>
              <dd className="text-slate-700">{p.meta.note}</dd>
            </>
          ) : null}

          <dt className="text-slate-400">수집 시각</dt>
          <dd className="tabular-nums text-slate-700">
            {new Date(p.meta.crawledAt).toLocaleString("ko-KR")}
          </dd>

          <dt className="text-slate-400">원본</dt>
          <dd className="truncate">
            <a
              href={p.meta.storeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-violet-600 hover:underline"
            >
              스토어 열기 ↗
            </a>
          </dd>
        </dl>
      </div>
    </div>
  );
}
