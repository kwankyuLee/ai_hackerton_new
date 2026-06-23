// 복지 서비스 데이터 타입
export type Verdict = "가능" | "불확실" | "추가확인";

export interface WelfareProgram {
  id: string;
  name: string;
  category: string[];
  lifeEvents: string[];
  summary: string;
  target: string; // 지원대상 (원문 톤)
  criteria: string; // 선정기준 (원문 톤)
  criteriaRules: {
    // 판별용 구조화 (근사치 — 실제 고시로 대체 필요)
    incomePctMax?: number; // 기준 중위소득 % 상한
    crisisRequired?: boolean; // 위기사유 필요
    needsChild?: boolean; // 자녀(취학) 필요
    jobSeeking?: boolean; // 구직 의사 필요
    noIncomeOk?: boolean; // 소득 없음이 오히려 요건
  };
  benefit: string; // 서비스내용(급여)
  applyMethod: string; // 신청방법
  documents: string[]; // 구비서류
  deadline: string;
  contact: string;
  law: string;
  sourceUrl: string;
  easyCache: {
    easy: string; // 쉬운말 설명 (LLM 폴백용 사전 캐싱)
    todo: string[]; // 내가 할 일
  };
}

// 사용자 자가서술에서 추출한 사실
export interface UserFacts {
  lifeEvent: string; // 실직 등
  householdSize: number; // 가구원 수
  incomeBand: IncomeBand; // 대략 월소득 구간
  hasChild: boolean; // 취학 자녀 여부
  jobSeeking: boolean; // 구직 의사
  raw?: string; // 원문
}

export type IncomeBand = "none" | "under100" | "100to200" | "200to300" | "over300";

export interface MatchedResult {
  program: WelfareProgram;
  verdict: Verdict;
  reason: string; // 근거 문장
  missing: string[]; // 추가 확인 필요 항목
}
