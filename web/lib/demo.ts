// /demo 파이프라인 재생용 모델 — output/{slug}.run.json (RunReporter 산출)을 그대로 읽는다.

export type StageId =
  | 'input'
  | 'adapter'
  | 'login'
  | 'list'
  | 'price'
  | 'extract'
  | 'category'
  | 'ai'
  | 'bundle'
  | 'lowest'
  | 'validate'
  | 'output';

export interface RunEvent {
  t: number;
  stage: StageId;
  line: string;
  level: 'log' | 'error' | 'mark';
}

export interface RunLog {
  store: string;
  url: string;
  startedAt: string;
  durationMs: number;
  totals: Record<string, number>;
  stages: StageId[];
  events: RunEvent[];
}

// 색 그룹 — 흐름도/영상과 동일한 트러스트테크 팔레트.
export type StageGroup = 'entry' | 'crawl' | 'ai' | 'low' | 'gate' | 'out';

export const GROUP_COLOR: Record<StageGroup, string> = {
  entry: '#2D6BFF',
  crawl: '#16A34A',
  ai: '#2563EB',
  low: '#9333EA',
  gate: '#FB4D52',
  out: '#1B47C2',
};

export interface StageDef {
  id: StageId;
  label: string;
  sub: string;
  group: StageGroup;
}

// 흐름도 B를 가독성 우선으로 정리한 단계 정의(전체). 실제 표시는 run.stages 에 등장한 것만.
export const STAGE_DEFS: StageDef[] = [
  { id: 'input', label: 'URL 입력', sub: '브랜드몰 주소 하나', group: 'entry' },
  { id: 'adapter', label: '어댑터 매칭', sub: '네이버 · 고도몰 자동 판별', group: 'entry' },
  { id: 'login', label: '인증 세션', sub: '본인 로그인 세션 재사용', group: 'crawl' },
  { id: 'list', label: '목록 전수 수집', sub: '페이지네이션 순회', group: 'crawl' },
  { id: 'price', label: '가격 배치 조회', sub: '개별 호출 회피', group: 'crawl' },
  { id: 'extract', label: '결정적 추출', sub: '이름·가격·옵션·이미지', group: 'crawl' },
  { id: 'category', label: '사이트 카테고리 수집', sub: 'AI 분류 컨텍스트', group: 'ai' },
  { id: 'ai', label: '정규화 + AI 보강', sub: '카테고리·USP·해시태그·옵션', group: 'ai' },
  { id: 'bundle', label: '묶음 가격 보정', sub: '낱개 매칭·할인 복원', group: 'crawl' },
  { id: 'lowest', label: '최저가 실조회', sub: '네이버+에누리 · 오탐 방지', group: 'low' },
  { id: 'validate', label: '검증 단일 관문', sub: 'validate.ts — 환각 차단', group: 'gate' },
  { id: 'output', label: 'JSON + 품질 리포트', sub: '큐닷 제안서', group: 'out' },
];

export const STAGE_DEF: Record<StageId, StageDef> = Object.fromEntries(
  STAGE_DEFS.map((s) => [s.id, s])
) as Record<StageId, StageDef>;

/** run.stages(발생 순서)를 STAGE_DEFS 표준 순서로 정렬해 표시용 단계 목록 생성 */
export function visibleStages(run: RunLog): StageDef[] {
  const present = new Set(run.stages);
  return STAGE_DEFS.filter((s) => present.has(s.id));
}
