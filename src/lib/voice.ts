// 클라이언트 음성 유틸 — OpenAI(STT/TTS) 우선, 브라우저 Web Speech 폴백

/** 텍스트를 음성으로 읽기. OpenAI TTS → 실패 시 브라우저 TTS */
export async function speak(text: string): Promise<void> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("tts api failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await audio.play();
    audio.onended = () => URL.revokeObjectURL(url);
    return;
  } catch {
    // 폴백: 브라우저 내장 TTS
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR";
      u.rate = 0.95;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  }
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/** 마이크 녹음 → OpenAI Whisper(STT). 반환: 인식 텍스트 */
export async function recordAndTranscribe(
  onStart: () => void,
  signal: { stop?: () => void }
): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: "audio/webm" }));
    };
  });

  recorder.start();
  onStart();
  signal.stop = () => recorder.state !== "inactive" && recorder.stop();

  const blob = await done;
  const form = new FormData();
  form.append("audio", blob, "speech.webm");
  const res = await fetch("/api/stt", { method: "POST", body: form });
  if (!res.ok) throw new Error("stt api failed");
  const data = await res.json();
  return (data.text as string) ?? "";
}
