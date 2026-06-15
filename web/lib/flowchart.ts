// flow-B 상세 흐름도(docs/flow-preview.html B와 동일) + 단계→노드 매핑.
// /demo 가 이 흐름도를 그대로 띄우고, 진행 단계에 맞춰 노드를 점등한다.
// 안 타는 분기(ERR·OCRY·HEALY·반대 어댑터)는 흐리게 남아 "조건분기"가 드러난다.

import type { StageId } from './demo';

export const MERMAID_DEF = `flowchart TD
    URL["<b>URL 입력</b>"]:::entry --> ADP{"어댑터 매칭"}:::dec
    ADP -->|네이버| NV["<b>NaverStoreAdapter</b><br/>인증 세션 + 내부 JSON API"]:::crawl
    ADP -->|고도몰| GD["<b>GodomallAdapter</b><br/>순수 HTTP fetch"]:::crawl
    ADP -->|그 외| ERR["<b>명확한 에러</b><br/>(어댑터 추가하면 동작)"]:::opt

    NV --> LIST["<b>목록 전수 수집</b>"]:::crawl
    GD --> LIST
    LIST --> PRICE["<b>가격 배치 조회</b><br/>(개별 호출 회피)"]:::crawl
    PRICE --> INC{"증분 모드?"}:::dec
    INC -.신규·가격변경만.-> LOOP
    INC -->|전수| LOOP["<b>상품별 결정적 추출</b><br/>이름 · 가격 · 옵션 · 이미지"]:::crawl

    LOOP --> OCR{"근거 부족<br/>+ 상세이미지?"}:::dec
    OCR -.opt-in.-> OCRY["<b>조건부 OCR 보강</b>"]:::opt
    OCR --> HEAL{"핵심필드<br/>누락?"}:::dec
    OCRY --> HEAL
    HEAL -.안전망.-> HEALY["<b>자가복구</b><br/>(ai-recovery)"]:::opt
    HEAL --> CAT["<b>사이트 카테고리 수집</b><br/>(AI 분류 컨텍스트)"]:::ai
    HEALY --> CAT

    CAT --> AI["<b>정규화 + AI 보강</b><br/>카테고리 · USP · 해시태그 · 3축 옵션"]:::ai
    AI --> BUNDLE["<b>묶음 가격 보정</b>"]:::crawl
    BUNDLE --> LOW["<b>최저가 실조회 (가산점)</b><br/>네이버 + 에누리 · 자사 제외<br/>오탐 시 null + 사유"]:::low
    LOW --> VAL["<b>검증 단일 관문</b><br/>validate.ts — 환각 차단"]:::gate
    VAL --> OUT["<b>JSON + 품질 리포트</b>"]:::out
    OUT --> WEB["<b>검수 뷰어 (web/)</b><br/>provenance 색코딩"]:::out

    classDef entry fill:#EAF1FF,stroke:#2D6BFF,color:#1B47C2,stroke-width:2px;
    classDef crawl fill:#E7F6EE,stroke:#16A34A,color:#0F7A37,stroke-width:1.5px;
    classDef ai fill:#E9F0FE,stroke:#2563EB,color:#1D4FD7,stroke-width:1.5px;
    classDef low fill:#F5E9FD,stroke:#9333EA,color:#7A23C0,stroke-width:1.5px;
    classDef gate fill:#FFEAEB,stroke:#FB4D52,color:#C42E33,stroke-width:2px;
    classDef out fill:#2D6BFF,stroke:#1B47C2,color:#FFFFFF,stroke-width:1px;
    classDef opt fill:#F1F5F9,stroke:#94A3B8,color:#5E6E85,stroke-dasharray:5 4;
    classDef dec fill:#FFFFFF,stroke:#2D6BFF,color:#0B1220,stroke-width:1.5px;`;

// 단계 → 점등할 노드 id(들). 어댑터 분기는 네이버/고도몰에 따라 갈린다.
export function stageNodes(stage: StageId, isNaver: boolean): string[] {
  switch (stage) {
    case 'input': return ['URL'];
    case 'adapter': return isNaver ? ['ADP', 'NV'] : ['ADP', 'GD'];
    case 'login': return isNaver ? ['NV'] : [];
    case 'list': return ['LIST'];
    case 'price': return ['PRICE'];
    case 'extract': return ['INC', 'LOOP', 'OCR', 'HEAL'];
    case 'category': return ['CAT'];
    case 'ai': return ['AI'];
    case 'bundle': return ['BUNDLE'];
    case 'lowest': return ['LOW'];
    case 'validate': return ['VAL'];
    case 'output': return ['OUT', 'WEB'];
    default: return [];
  }
}

/** 진행 단계(라이브/재생 공통, 스트리밍 줄에서 derive) 기준 노드 상태 집합 계산.
 *  stagesOrder: 지금까지 등장한 단계(순서). optional: 실제로 탄 OCRY/HEALY. */
export function nodeSets(
  stagesOrder: StageId[],
  activeStage: StageId | null,
  isNaver: boolean,
  optional: Set<string>
): { active: Set<string>; done: Set<string> } {
  const active = new Set<string>(activeStage ? stageNodes(activeStage, isNaver) : []);
  const done = new Set<string>();
  if (activeStage) {
    const ai = stagesOrder.indexOf(activeStage);
    for (let i = 0; i < ai; i++) {
      for (const n of stageNodes(stagesOrder[i], isNaver)) done.add(n);
    }
    if (ai > stagesOrder.indexOf('extract') && stagesOrder.includes('extract')) {
      for (const n of optional) done.add(n);
    }
  }
  return { active, done };
}
