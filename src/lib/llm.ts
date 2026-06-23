// 서버 전용: Claude 원시 REST 호출 헬퍼
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export function hasLLMKey() {
  return !!KEY;
}

export async function askClaude(prompt: string, maxTokens = 1500): Promise<string> {
  if (!KEY) throw new Error("no_anthropic_key");
  // 주의: claude-opus-4-8은 temperature 파라미터를 받지 않음(deprecated)
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error("anthropic HTTP " + res.status);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

export function extractJson<T = unknown>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
