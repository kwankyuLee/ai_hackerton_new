import type { IncomeBand, UserFacts } from "@/lib/types";

// 키워드 기반 간단 사실 추출 (LLM 없이 동작 — 폴백/프리필용)
export function extractFactsHeuristic(raw: string): Partial<UserFacts> {
  const t = raw.replace(/\s/g, "");
  const facts: Partial<UserFacts> = { raw };

  // 생애사건: 실직 신호
  if (/(실직|그만|잘렸|해고|퇴사|짤렸|일자리를잃|회사를나)/.test(t)) {
    facts.lifeEvent = "실직";
  }

  // 자녀
  if (/(아이|애|자녀|딸|아들|애기|육아|학교|학생)/.test(t)) facts.hasChild = true;

  // 소득
  if (/(소득이없|돈이없|벌이가없|수입이없|막막|생계가곤란|무직)/.test(t)) {
    facts.incomeBand = "none" as IncomeBand;
  }

  // 구직 의사
  if (/(구직|일자리|취업|재취업|일을구|일하고싶)/.test(t)) facts.jobSeeking = true;

  // 가구원 수 (대략): "N인", "N명", "애가 둘/셋" 등
  const sizeMatch = t.match(/(\d+)(인|명)가구|가구.*?(\d+)(인|명)/);
  if (sizeMatch) {
    const n = Number(sizeMatch[1] || sizeMatch[3]);
    if (n >= 1 && n <= 8) facts.householdSize = n;
  }

  return facts;
}
