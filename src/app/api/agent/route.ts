import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

export const runtime = "nodejs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// 자연어 상황 → 구조화 사실 + 공감 한마디 (Claude Opus 4.8)
export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "no_anthropic_key" }, { status: 503 });

  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "no_text" }, { status: 400 });
    }

    const anthropic = createAnthropic({ apiKey: key });
    const { text: out } = await generateText({
      model: anthropic(MODEL),
      temperature: 0.2,
      prompt: `너는 대한민국 복지 안내 도우미야. 사용자가 자신의 상황을 한국어로 말했어.
아래 상황에서 사실을 추출하고, 따뜻한 공감 한 문장을 만들어 줘.

상황: """${text}"""

반드시 아래 JSON만 출력해(설명 금지):
{
  "lifeEvent": "실직" | "기타",
  "householdSize": 1~8 정수(모르면 1),
  "incomeBand": "none" | "under100" | "100to200" | "200to300" | "over300",
  "hasChild": true | false,
  "jobSeeking": true | false,
  "ack": "사용자 상황을 짧게 되짚어주는 따뜻한 한 문장(쉬운말)"
}`,
    });

    const match = out.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;
    if (!parsed) throw new Error("parse_failed");

    return NextResponse.json({ facts: parsed, ack: parsed.ack });
  } catch (e) {
    console.error("agent error", e);
    return NextResponse.json({ error: "agent_failed" }, { status: 500 });
  }
}
