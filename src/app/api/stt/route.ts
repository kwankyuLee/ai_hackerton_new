import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

export const runtime = "nodejs";

// 음성 → 텍스트 (OpenAI Whisper)
export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "no_openai_key" }, { status: 503 });
  }

  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "no_audio" }, { status: 400 });
    }

    // 바이트를 온전히 읽어 업로드 (스트림 직접 전달 시 깨질 수 있음)
    const buffer = Buffer.from(await audio.arrayBuffer());
    const file = await toFile(buffer, audio.name || "speech.webm", {
      type: audio.type || "audio/webm",
    });

    const openai = new OpenAI({ apiKey: key });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "ko",
    });

    return NextResponse.json({ text: transcription.text });
  } catch (e) {
    console.error("STT error", e);
    return NextResponse.json({ error: "stt_failed" }, { status: 500 });
  }
}
