import { WELFARE } from "@/data/welfare";
import { estimateIncomePct } from "@/lib/income";
import type { MatchedResult, UserFacts, Verdict, WelfareProgram } from "@/lib/types";

// 1단계: 생애사건/태그로 후보 복지 거르기 (결정론)
export function searchWelfare(facts: UserFacts): WelfareProgram[] {
  return WELFARE.filter(
    (p) =>
      p.lifeEvents.includes(facts.lifeEvent) ||
      p.lifeEvents.some((e) => ["저소득", "위기", "구직"].includes(e))
  );
}

// 2~3단계: 자격 가능성 판별 (결정론 규칙 + 소득 러프 스크린)
export function checkEligibility(p: WelfareProgram, facts: UserFacts): MatchedResult {
  const r = p.criteriaRules;
  const missing: string[] = [];
  let verdict: Verdict = "가능";

  const downgrade = (to: Verdict) => {
    const rank: Record<Verdict, number> = { 가능: 0, 불확실: 1, 추가확인: 2 };
    if (rank[to] > rank[verdict]) verdict = to;
  };

  // 위기사유 (실직은 위기사유로 인정)
  const isCrisis = facts.lifeEvent === "실직" || facts.lifeEvent === "위기";
  if (r.crisisRequired && !isCrisis) {
    missing.push("갑작스러운 위기사유(실직 등)");
    downgrade("추가확인");
  }

  // 취학 자녀 필요
  if (r.needsChild && !facts.hasChild) {
    missing.push("초·중·고 자녀 여부");
    downgrade("추가확인");
  }

  // 구직 의사 필요
  if (r.jobSeeking && !facts.jobSeeking) {
    missing.push("구직 활동 참여 의사");
    downgrade("불확실");
  }

  // 소득 러프 스크린
  if (typeof r.incomePctMax === "number") {
    const pct = estimateIncomePct(facts.incomeBand, facts.householdSize);
    if (pct <= r.incomePctMax) {
      // 충족 가능성 높음
    } else if (pct <= r.incomePctMax * 1.25) {
      missing.push("정확한 소득·재산 확인");
      downgrade("불확실");
    } else {
      missing.push("소득 기준 충족 여부(소득이 기준보다 높을 수 있음)");
      downgrade("추가확인");
    }
  }

  // 소득 없음이 요건인 경우
  if (r.noIncomeOk) {
    if (facts.incomeBand === "none" || facts.incomeBand === "under100") {
      // 가능
    } else {
      missing.push("현재 소득 유무 확인");
      downgrade("불확실");
    }
  }

  return { program: p, verdict, reason: buildReason(p, facts, verdict), missing };
}

function buildReason(p: WelfareProgram, facts: UserFacts, verdict: Verdict): string {
  const parts: string[] = [];
  if (p.criteriaRules.crisisRequired && facts.lifeEvent === "실직") {
    parts.push("회사를 갑자기 그만둔 위기 상황에 해당하고");
  }
  if (typeof p.criteriaRules.incomePctMax === "number") {
    if (verdict === "가능") parts.push(`소득이 기준(중위소득 ${p.criteriaRules.incomePctMax}% 이하)에 들 가능성이 높아요`);
    else parts.push(`소득이 기준(중위소득 ${p.criteriaRules.incomePctMax}% 이하)에 드는지 확인이 필요해요`);
  }
  if (p.criteriaRules.needsChild && facts.hasChild) parts.push("초·중·고 자녀가 있어 대상이 돼요");
  if (p.criteriaRules.noIncomeOk) parts.push("지금 소득이 없어 신청 대상이 돼요");

  const head =
    verdict === "가능" ? "받을 가능성이 높아요. " : verdict === "불확실" ? "받을 수도 있어요. " : "조금 더 확인이 필요해요. ";
  return head + (parts.length ? parts.join(", ") + "." : "");
}

// 전체 파이프라인: 사실 → 후보 → 판별 → 가능성 높은 순 정렬
export function runMatch(facts: UserFacts): MatchedResult[] {
  const rank: Record<Verdict, number> = { 가능: 0, 불확실: 1, 추가확인: 2 };
  return searchWelfare(facts)
    .map((p) => checkEligibility(p, facts))
    .sort((a, b) => rank[a.verdict] - rank[b.verdict]);
}
