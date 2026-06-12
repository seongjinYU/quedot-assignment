// provenance.method → 색/라벨 매핑. 검수 UI의 핵심 시각 언어.
// "포렌식 원장" 컨셉: 본문은 잉크/종이(무채색), 색은 오직 "증거 유형"에만.
// 신뢰(결정적)=음영 없음(종이), 검수 대상(AI·자가복구·공란 등)만 옅은 셀 음영 + 점.
// Tailwind v4 가 소스의 클래스 문자열을 스캔하므로 반드시 "리터럴 전체 문자열"로 둔다.

import type { FillMethod, FieldProvenance, ProductField } from './types';

export interface MethodStyle {
  label: string;
  desc: string;
  dot: string; // 점 색 (bg-*)
  tint: string; // 셀 배경 음영 (bg-*) — 신뢰는 빈 문자열
  badge: string; // 배지(bg+text+ring)
}

export const METHOD_META: Record<FillMethod, MethodStyle> = {
  deterministic: {
    label: '결정적',
    desc: '내부 JSON/HTML에서 원본 그대로 추출 — 신뢰',
    dot: 'bg-emerald-500',
    tint: '',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  crawled: {
    label: '크롤',
    desc: '외부 실조회 수집값(출처·수집 시각 동반)',
    dot: 'bg-sky-500',
    tint: 'bg-sky-50',
    badge: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  calculated: {
    label: '계산',
    desc: '다른 값에서 파생 계산(예: 정가−판매가 → 할인율)',
    dot: 'bg-amber-500',
    tint: 'bg-amber-50',
    badge: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  ai: {
    label: 'AI',
    desc: 'LLM 분류·생성 — 근거 표기, 검수 권장',
    dot: 'bg-violet-500',
    tint: 'bg-violet-50',
    badge: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  'ai-recovery': {
    label: '자가복구',
    desc: '결정적 추출 실패를 LLM이 재분석·복구 — 확인 필요',
    dot: 'bg-red-500',
    tint: 'bg-red-50',
    badge: 'bg-red-50 text-red-700 ring-red-200',
  },
  empty: {
    label: '공란',
    desc: '못 얻은 값을 지어내지 않고 사유와 함께 비움',
    dot: 'bg-stone-300',
    tint: 'bg-stone-200/45',
    badge: 'bg-stone-100 text-stone-500 ring-stone-300',
  },
};

export const METHOD_ORDER: FillMethod[] = [
  'deterministic',
  'crawled',
  'calculated',
  'ai',
  'ai-recovery',
  'empty',
];

// "AI 배치" — 옵션(option1/2)의 method=ai 는 값을 생성한 게 아니라,
// 3축 옵션을 큐닷 option1/2 "2칸"에 압축·배치하는 의미 판단만 AI가 한 것.
// (≤2축은 위치 기반 룰=결정적, 3축+만 LLM — openai.ts 라우팅)
// 값 자체는 원본이므로 일반 AI(생성)와 색·라벨을 분리해 과장 표시를 막는다.
export const OPTION_FIELDS = new Set<ProductField>(['option1', 'option2']);

export const PLACEMENT_STYLE: MethodStyle = {
  label: 'AI 배치',
  desc: '값은 원본 · 3축 옵션을 option1/2 2칸으로 압축·배치만 AI',
  dot: 'bg-teal-500',
  tint: 'bg-teal-50',
  badge: 'bg-teal-50 text-teal-700 ring-teal-200',
};

/** 필드+provenance 로 실제 표시 스타일 결정. 옵션의 ai 는 "AI 배치"로 분리. */
export function getFieldDisplay(
  field: ProductField | string | undefined,
  prov: FieldProvenance
): MethodStyle {
  if (field && OPTION_FIELDS.has(field as ProductField) && prov.method === 'ai') {
    return PLACEMENT_STYLE;
  }
  return METHOD_META[prov.method];
}
