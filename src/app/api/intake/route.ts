import { NextResponse } from "next/server";
import { askClaude, extractJson, hasLLMKey } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 30;

// AI 되묻기: 상황을 읽고, 복지를 정확히 찾기 위해 필요한 추가 질문만 생성
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };

  if (!hasLLMKey()) {
    // 폴백: 기본 질문 세트
    return NextResponse.json({
      ack: "",
      questions: DEFAULT_QUESTIONS,
    });
  }

  try {
    const raw = await askClaude(
      `너는 대한민국 복지 상담 도우미야. 한 사람이 자기 상황을 이렇게 말했어:
"${text}"

이 사람에게 맞는 복지를 정확히 찾으려면, 추가로 꼭 필요한 정보만 1~3개 물어봐.
이미 말한 내용은 다시 묻지 마. 상황에 맞는 질문만(예: 소득수준, 가구원 수, 자녀 유무, 나이, 거주형태, 장애·질병 여부 등).
각 질문은 손쉽게 고를 선택지(2~5개)를 줘. 그리고 따뜻한 공감 한 문장.

아래 JSON만 출력(설명 금지):
{
 "ack": "공감 한 문장(쉬운말)",
 "questions": [
   {"key":"income","label":"질문 문구","options":["선택지1","선택지2",...]}
 ]
}`,
      900
    );
    const parsed = extractJson<{ ack: string; questions: Question[] }>(raw);
    if (!parsed || !Array.isArray(parsed.questions)) throw new Error("parse_failed");
    // 질문 최대 3개로 제한
    parsed.questions = parsed.questions.slice(0, 3);
    return NextResponse.json(parsed);
  } catch (e) {
    console.error("intake failed:", e);
    return NextResponse.json({ ack: "", questions: DEFAULT_QUESTIONS });
  }
}

interface Question {
  key: string;
  label: string;
  options: string[];
}

const DEFAULT_QUESTIONS: Question[] = [
  { key: "household", label: "가족이 몇 명인가요?", options: ["1명", "2명", "3명", "4명", "5명 이상"] },
  { key: "income", label: "요즘 한 달 수입은 어느 정도인가요?", options: ["거의 없음", "100만원 이하", "100~200만원", "200~300만원", "300만원 이상"] },
  { key: "child", label: "초·중·고 자녀가 있나요?", options: ["네, 있어요", "아니요"] },
];
