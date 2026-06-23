import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

// 텍스트 → 음성 (OpenAI TTS)
export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "no_openai_key" }, { status: 503 });
  }

  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "no_text" }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: key });
    const speech = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: text.slice(0, 1000),
    });

    const buffer = Buffer.from(await speech.arrayBuffer());
    return new NextResponse(buffer, {
      headers: { "Content-Type": "audio/mpeg" },
    });
  } catch (e) {
    console.error("TTS error", e);
    return NextResponse.json({ error: "tts_failed" }, { status: 500 });
  }
}
