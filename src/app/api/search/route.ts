import { NextResponse } from "next/server";
import { searchWelfareLive, getDetailLive, hasDataKey, type Detail } from "@/lib/datago";
import { askClaude, extractJson, hasLLMKey } from "@/lib/llm";
import { runMatch } from "@/lib/match";
import { extractFactsHeuristic } from "@/lib/extract";
import type { MatchedResult, UserFacts } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// 실시간 복지 에이전트: 상황+추가답변 → 검색어 → data.go.kr 라이브 → 자격 판단(해당없음 포함)
export async function POST(req: Request) {
  const { text, context } = (await req.json()) as { text: string; context?: string };
  const full = [text, context].filter(Boolean).join("\n");

  if (!hasLLMKey() || !hasDataKey()) {
    return NextResponse.json({ results: fallback(full), source: "cache", trace: ["사전 데이터로 안내"], excluded: 0 });
  }

  try {
    const trace: string[] = [];

    // 1) 상황 → 검색어 추출
    const kwRaw = await askClaude(
      `복지가 필요한 사람의 상황이야:
"${full}"
이 사람이 찾아볼 만한 대한민국 정부 복지서비스 검색 키워드 5개를 상황에 맞게 골라줘(제도명·분야 위주). JSON 배열만: ["k1","k2","k3","k4","k5"]`,
      200
    );
    const llmKeywords = extractJson<string[]>(kwRaw) || [];
    // 안정화: 핵심 복지(항상 검토, 안 맞으면 해당없음으로 걸러짐) + AI 상황별 검색어
    const CORE = ["긴급복지", "생계급여", "주거급여", "국민취업지원"];
    const keywords = [...new Set([...CORE, ...llmKeywords])].slice(0, 7);
    trace.push(`검색어: ${keywords.join(", ")}`);

    // 2) data.go.kr 실시간 목록조회 (병렬) — 키워드별로 다양하게 후보 수집
    const lists = await Promise.all(keywords.map((kw) => searchWelfareLive(kw).catch(() => [])));
    const seen = new Set<string>();
    const candidates: { servId: string; servNm: string; summary: string }[] = [];
    // 라운드로빈: 키워드마다 상위 2개씩 → 한 묶음이 독점하지 않게
    for (let rank = 0; rank < 3; rank++) {
      for (const list of lists) {
        const c = list[rank];
        if (c && c.servId && !seen.has(c.servId)) {
          seen.add(c.servId);
          candidates.push(c);
        }
      }
    }
    if (candidates.length === 0) throw new Error("no_candidates");
    trace.push(`복지 ${candidates.length}건 실시간 검색됨`);

    // 3) 상위 후보 상세조회 (병렬, 최대 6건)
    const details = (
      await Promise.all(candidates.slice(0, 6).map((c) => getDetailLive(c.servId).catch(() => null)))
    ).filter((d): d is Detail => !!d && !!d.criteria);
    if (details.length === 0) throw new Error("no_details");
    trace.push(`${details.length}건 자격조건 분석`);

    // 4) 프로그램별 판단·생성 (병렬) — 해당없음 포함
    const all = (await Promise.all(details.map((d) => judgeOne(full, d)))).filter(
      (r): r is JudgedResult => !!r
    );

    // 해당없음은 제외, 나머지는 가능성 순 정렬
    const excluded = all.filter((r) => r.verdict === "해당없음").length;
    const order: Record<string, number> = { 가능: 0, 불확실: 1, 추가확인: 2 };
    const results = all
      .filter((r) => r.verdict !== "해당없음")
      .sort((a, b) => order[a.verdict] - order[b.verdict]);
    trace.push(`AI 판단 완료 (해당 ${results.length} / 제외 ${excluded})`);

    return NextResponse.json({ results, source: "live", trace, excluded });
  } catch (e) {
    console.error("search live failed, fallback:", e);
    return NextResponse.json({ results: fallback(full), source: "cache", trace: ["실시간 처리 실패 → 사전 데이터로 안내"], excluded: 0 });
  }
}

type Verdict = "가능" | "불확실" | "추가확인" | "해당없음";
type JudgedResult = Omit<MatchedResult, "verdict"> & { verdict: Verdict };

// 복지 1건을 사용자 상황과 대조해 판단(해당없음 가능)·쉬운말 생성
async function judgeOne(situation: string, d: Detail): Promise<JudgedResult | null> {
  const prompt = `너는 대한민국 복지 안내 도우미야. 한 국민의 상황과 정부 복지서비스의 실제 자격조건을 대조해, 이 복지를 받을 가능성을 정직하게 판단해줘.

[국민 상황]
${situation}

[복지서비스] ${d.servNm} (소관: ${d.jurMnofNm})
지원대상: ${d.target.slice(0, 550)}
선정기준: ${d.criteria.slice(0, 750)}
급여: ${d.benefit.slice(0, 350)}

[소득 판단 — 반드시 이 순서로]
1) 선정기준에서 소득 상한을 찾아라(예: "기준 중위소득 75% 이하").
2) 참고 기준 중위소득 100%(월): 1인 약 240만원, 2인 약 393만원, 3인 약 502만원, 4인 약 609만원, 5인 약 710만원.
   → 사용자 가구원 수에 맞는 100% 값에 상한 %를 곱해 '소득 상한 금액'을 구하라.
3) 사용자의 월소득과 비교하라.
   - 사용자 소득이 상한 금액보다 명백히 높으면 → 반드시 "해당없음"
   - 상한 금액 이하이면(예: 소득이 거의 없음) → "가능" (재산 등 부차 조건은 신청 때 확인하면 되니 "가능"으로 둬라)
   - 소득이 상한 근처라 애매하면 → "추가확인"

판단 기준:
- "가능": 소득이 기준 이하이고 대상 집단도 맞음 → 자신 있게 "가능"으로
- "불확실": 대상은 맞지만 핵심 조건 하나가 불명확
- "추가확인": 소득이 경계선
- "해당없음": 소득이 기준을 명백히 초과하거나, 대상 집단(노인·장애인·특정질환·특정연령 등)이 사용자와 다름
* 소득이 명백히 낮은데 자산을 핑계로 "추가확인"으로 깎지 마라. 소득이 기준 이하면 "가능".
* 반대로 억지로 맞추지도 마라. 안 맞으면 "해당없음".

아래 JSON만 출력(설명 금지):
{"verdict":"가능|불확실|추가확인|해당없음","reason":"왜 해당/비해당인지 핵심만 쉬운말 1~2문장. 중요한 단어(소득 기준·대상·금액·핵심 사유)는 **별표 두개**로 감싸 강조. 예: 갑자기 **실직**해 소득이 없고, **중위소득 75% 이하** 조건에 들어 받을 수 있어요.","easy":"무엇을 도와주는지 2~3문장 쉬운말(금액 있으면 포함)","todo":["지금 할 일 1~2개"],"documents":["필요 서류 추정 1~3개"]}
반드시 위 선정기준에 근거하고, 없는 내용은 지어내지 마. 안 맞으면 솔직히 "해당없음".`;

  try {
    const raw = await askClaude(prompt, 800);
    const j = extractJson<{ verdict: string; reason: string; easy: string; todo: string[]; documents: string[] }>(raw);
    if (!j) return null;
    const verdict = (["가능", "불확실", "추가확인", "해당없음"].includes(j.verdict) ? j.verdict : "불확실") as Verdict;
    return {
      program: {
        id: d.servId,
        name: d.servNm,
        category: [],
        lifeEvents: [],
        summary: d.summary || j.easy,
        target: d.target,
        criteria: d.criteria,
        criteriaRules: {},
        benefit: d.benefit,
        applyMethod: d.applyMethod,
        documents: j.documents || [],
        deadline: "기관 확인",
        contact: d.contact || "보건복지상담센터 129",
        law: "",
        sourceUrl: `https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=${d.servId}`,
        easyCache: { easy: j.easy, todo: j.todo || [] },
      },
      verdict,
      reason: j.reason,
      missing: [],
    };
  } catch {
    return null;
  }
}

// 키 없거나 실패 시: 휴리스틱 사실 → 캐시 매칭
function fallback(situation: string): MatchedResult[] {
  const f = extractFactsHeuristic(situation);
  const facts: UserFacts = {
    lifeEvent: f.lifeEvent || "실직",
    householdSize: f.householdSize || 1,
    incomeBand: f.incomeBand || "none",
    hasChild: f.hasChild ?? false,
    jobSeeking: f.jobSeeking ?? false,
    raw: situation,
  };
  return runMatch(facts);
}
