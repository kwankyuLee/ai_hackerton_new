import { NextResponse } from "next/server";
import { searchWelfareLive, getDetailLive, hasDataKey, type Detail } from "@/lib/datago";
import { askClaude, extractJson, hasLLMKey } from "@/lib/llm";
import { runMatch } from "@/lib/match";
import { INCOME_BAND_LABEL } from "@/lib/income";
import type { MatchedResult, UserFacts } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// 실시간 복지 에이전트: 질문 → 검색어 추출 → data.go.kr 라이브 → 자격 판단·생성
export async function POST(req: Request) {
  const { text, facts } = (await req.json()) as { text: string; facts: UserFacts };

  if (!hasLLMKey() || !hasDataKey()) {
    return NextResponse.json({ results: runMatch(facts), source: "cache", trace: ["사전 데이터로 안내"] });
  }

  try {
    const trace: string[] = [];

    // 1) 상황 → 검색어 추출
    const kwRaw = await askClaude(
      `복지가 필요한 사람이 이렇게 말했어: "${text}". 이 사람이 찾아볼 만한 대한민국 정부 복지서비스 검색 키워드 4개를 골라줘. 제도명 위주(예: 긴급복지, 생계급여, 주거급여, 교육급여, 국민취업지원). JSON 배열만: ["k1","k2","k3","k4"]`,
      200
    );
    const keywords = (extractJson<string[]>(kwRaw) || ["긴급복지", "생계급여", "국민취업지원", "주거급여"]).slice(0, 4);
    trace.push(`검색어 추출: ${keywords.join(", ")}`);

    // 2) data.go.kr 실시간 목록조회 (병렬)
    const lists = await Promise.all(
      keywords.map((kw) => searchWelfareLive(kw).catch(() => []))
    );
    const seen = new Set<string>();
    const candidates: { servId: string; servNm: string; summary: string }[] = [];
    for (const list of lists) {
      for (const c of list) {
        if (c.servId && !seen.has(c.servId)) {
          seen.add(c.servId);
          candidates.push(c);
        }
      }
    }
    if (candidates.length === 0) throw new Error("no_candidates");
    trace.push(`복지 ${candidates.length}건 실시간 검색됨`);

    // 3) 상위 후보 상세조회 (병렬, 쿼터 보호: 최대 5건)
    const details = (
      await Promise.all(candidates.slice(0, 5).map((c) => getDetailLive(c.servId).catch(() => null)))
    ).filter((d): d is Detail => !!d && !!d.criteria);
    if (details.length === 0) throw new Error("no_details");
    trace.push(`${details.length}건 자격조건 분석`);

    // 4) 프로그램별 판단·생성 (병렬 — 속도 핵심)
    const judged = (await Promise.all(details.map((d) => judgeOne(text, facts, d)))).filter(
      (r): r is MatchedResult => !!r
    );
    if (judged.length === 0) throw new Error("judge_failed");
    trace.push("AI 판단·쉬운말 생성 완료");

    const order: Record<string, number> = { 가능: 0, 불확실: 1, 추가확인: 2 };
    judged.sort((a, b) => order[a.verdict] - order[b.verdict]);

    return NextResponse.json({ results: judged, source: "live", trace });
  } catch (e) {
    console.error("search live failed, fallback:", e);
    return NextResponse.json({ results: runMatch(facts), source: "cache", trace: ["실시간 처리 실패 → 사전 데이터로 안내"] });
  }
}

// 복지 1건을 사용자 상황과 대조해 판단·쉬운말 생성 (작고 빠른 호출)
async function judgeOne(text: string, facts: UserFacts, d: Detail): Promise<MatchedResult | null> {
  const incomeLabel = INCOME_BAND_LABEL[facts.incomeBand];
  const prompt = `너는 대한민국 복지 안내 도우미야. 한 국민의 상황과 정부 복지서비스의 실제 자격조건을 대조해, 이 복지를 받을 가능성을 판단하고 쉬운말로 설명해줘.

[국민 상황] "${text}"
가구원 ${facts.householdSize}명 / 소득 ${incomeLabel} / 취학자녀 ${facts.hasChild ? "있음" : "없음"} / 구직중 ${facts.jobSeeking ? "예" : "아니오"}

[복지서비스] ${d.servNm}
지원대상: ${d.target.slice(0, 500)}
선정기준: ${d.criteria.slice(0, 700)}
급여: ${d.benefit.slice(0, 350)}

아래 JSON만 출력(설명 금지):
{"verdict":"가능|불확실|추가확인","reason":"선정기준 근거를 들어 1~2문장","easy":"무엇을 도와주는지 2~3문장 쉬운말(금액 있으면 포함)","todo":["지금 할 일 1~2개"],"documents":["필요 서류 추정 1~3개"]}
반드시 위 선정기준에 근거하고, 없는 내용은 지어내지 마.`;

  try {
    const raw = await askClaude(prompt, 800);
    const j = extractJson<{ verdict: string; reason: string; easy: string; todo: string[]; documents: string[] }>(raw);
    if (!j) return null;
    return {
      program: {
        id: d.servId,
        name: d.servNm,
        category: [],
        lifeEvents: [facts.lifeEvent],
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
      verdict: (["가능", "불확실", "추가확인"].includes(j.verdict) ? j.verdict : "불확실") as MatchedResult["verdict"],
      reason: j.reason,
      missing: [],
    };
  } catch {
    return null;
  }
}
