"use client";

import { useRef, useState } from "react";
import { runMatch } from "@/lib/match";
import { extractFactsHeuristic } from "@/lib/extract";
import { recordAndTranscribe, speak, stopSpeaking } from "@/lib/voice";
import type { MatchedResult, UserFacts } from "@/lib/types";

interface Q {
  key: string;
  label: string;
  options: string[];
}

type Step = "input" | "questions" | "searching" | "results" | "detail";

const STAGES = [
  "상황을 이해하고 검색어를 뽑는 중…",
  "공공데이터에서 복지를 실시간 검색하는 중…",
  "각 복지의 자격조건을 분석하는 중…",
  "받을 가능성을 판단하고 쉬운말로 정리하는 중…",
];

const EXAMPLES = [
  "회사를 갑자기 그만뒀어요. 아이가 둘이고 월세 살아요.",
  "3개월 전 실직했고 지금 소득이 없어요.",
  "권고사직 당했는데 뭘 받을 수 있는지 모르겠어요.",
];

const VERDICT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  가능: { bg: "var(--ok-bg)", fg: "var(--ok)", label: "받을 가능성 높음" },
  불확실: { bg: "var(--maybe-bg)", fg: "var(--maybe)", label: "받을 수도 있음" },
  추가확인: { bg: "var(--check-bg)", fg: "var(--check)", label: "추가 확인 필요" },
};

export default function Home() {
  const [step, setStep] = useState<Step>("input");
  const [raw, setRaw] = useState("");
  const [recording, setRecording] = useState(false);
  const recSignal = useRef<{ stop?: () => void }>({});

  // AI 되묻기 (동적 질문)
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [results, setResults] = useState<MatchedResult[]>([]);
  const [selected, setSelected] = useState<MatchedResult | null>(null);
  const [ack, setAck] = useState("");
  const [thinking, setThinking] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [source, setSource] = useState<"live" | "cache">("live");
  const [excluded, setExcluded] = useState(0);
  const [reason, setReason] = useState("");

  async function handleMic() {
    if (recording) {
      recSignal.current.stop?.();
      return;
    }
    try {
      const text = await recordAndTranscribe(() => setRecording(true), recSignal.current);
      setRecording(false);
      if (text) {
        setRaw((prev) => (prev ? prev + " " : "") + text);
      }
    } catch {
      setRecording(false);
      alert("음성 인식을 사용할 수 없어요. 글로 입력해 주세요.");
    }
  }

  // 입력 → AI 되묻기(intake): 부족한 정보만 동적 질문 생성
  async function goIntake() {
    if (!raw.trim()) return;
    setThinking(true);
    setAnswers({});
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      const data = await res.json();
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
      setAck(data.ack ?? "");
    } catch {
      setQuestions([]);
    } finally {
      setThinking(false);
      setStep("questions");
    }
  }

  // 답변 종합 → 실시간 검색
  async function goResults() {
    const context = questions
      .map((q) => (answers[q.key] ? `${q.label} → ${answers[q.key]}` : ""))
      .filter(Boolean)
      .join("\n");

    setStep("searching");
    setStageIdx(0);
    const timer = setInterval(() => setStageIdx((i) => Math.min(i + 1, STAGES.length - 1)), 2200);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw, context }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
      setSource(data.source ?? "cache");
      setExcluded(data.excluded ?? 0);
      setReason(data.reason ?? "");
    } catch {
      setReason("네트워크 또는 응답 지연으로 실시간 처리에 실패했어요");
      const f = extractFactsHeuristic(raw);
      const facts: UserFacts = {
        lifeEvent: f.lifeEvent || "실직",
        householdSize: f.householdSize || 1,
        incomeBand: f.incomeBand || "none",
        hasChild: f.hasChild ?? false,
        jobSeeking: f.jobSeeking ?? false,
        raw,
      };
      setResults(runMatch(facts));
      setSource("cache");
    } finally {
      clearInterval(timer);
      setStep("results");
    }
  }

  const possibleCount = results.filter((r) => r.verdict === "가능").length;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-24">
      <Header onReset={() => { stopSpeaking(); setStep("input"); setRaw(""); }} />

      {step === "input" && (
        <section className="mt-8">
          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight">
            지금 어떤 상황인지<br />편하게 말씀해 주세요.
          </h1>
          <p className="mt-3 text-[var(--ink-soft)]">
            로그인 없이, 받을 수 있는 복지를 쉬운말과 음성으로 알려드려요.
          </p>

          <div className="mt-6 rounded-2xl border border-[var(--hairline)] bg-[var(--parchment)] p-4">
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="예) 회사를 갑자기 그만뒀어요. 아이가 둘이고 월세 살아요."
              rows={4}
              className="focus-ring w-full resize-none rounded-xl bg-white p-4 text-lg leading-relaxed outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleMic}
                className="focus-ring flex-1 rounded-xl px-4 py-3 text-lg font-semibold text-white"
                style={{ background: recording ? "#cc3300" : "var(--action)" }}
              >
                {recording ? "● 멈추기 (듣는 중…)" : "🎤 말하기"}
              </button>
              <button
                onClick={goIntake}
                disabled={!raw.trim() || thinking}
                className="focus-ring flex-1 rounded-xl px-4 py-3 text-lg font-semibold disabled:opacity-40"
                style={{ background: "var(--ink)", color: "white" }}
              >
                {thinking ? "AI가 읽는 중…" : "다음 →"}
              </button>
            </div>
          </div>

          <p className="mt-6 text-sm font-medium text-[var(--ink-soft)]">이렇게 말해보세요</p>
          <div className="mt-2 flex flex-col gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setRaw(ex)}
                className="focus-ring rounded-xl border border-[var(--hairline)] bg-white px-4 py-3 text-left text-[var(--ink)] hover:border-[var(--action)]"
              >
                “{ex}”
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "questions" && (
        <section className="mt-8">
          <h2 className="text-2xl font-semibold">몇 가지만 여쭤볼게요</h2>
          <p className="mt-2 text-[var(--ink-soft)]">정확히 찾기 위해 AI가 꼭 필요한 것만 물어봐요.</p>

          {ack && (
            <div className="mt-4 rounded-2xl border border-[var(--hairline)] bg-[var(--parchment)] p-4">
              <p className="text-sm font-semibold text-[var(--action)]">AI가 이렇게 이해했어요</p>
              <p className="mt-1">{ack}</p>
            </div>
          )}

          {questions.length === 0 && (
            <p className="mt-6 text-[var(--ink-soft)]">추가로 여쭤볼 게 없어요. 바로 찾아볼게요.</p>
          )}

          {questions.map((q) => (
            <Question key={q.key} label={q.label}>
              {q.options.map((opt) => (
                <Choice
                  key={opt}
                  active={answers[q.key] === opt}
                  onClick={() => setAnswers((a) => ({ ...a, [q.key]: opt }))}
                >
                  {opt}
                </Choice>
              ))}
            </Question>
          ))}

          <div className="mt-8 flex gap-2">
            <button onClick={() => setStep("input")} className="focus-ring rounded-xl border border-[var(--hairline)] px-5 py-3 text-lg font-semibold">
              ← 이전
            </button>
            <button onClick={goResults} className="focus-ring flex-1 rounded-xl px-5 py-3 text-lg font-semibold text-white" style={{ background: "var(--action)" }}>
              복지 찾기
            </button>
          </div>
        </section>
      )}

      {step === "searching" && (
        <section className="mt-10">
          <h2 className="text-2xl font-semibold">AI가 복지를 찾고 있어요</h2>
          <p className="mt-2 text-[var(--ink-soft)]">공공데이터를 실시간으로 검색하고 분석합니다.</p>
          <ul className="mt-6 flex flex-col gap-3">
            {STAGES.map((s, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-xl border p-4 text-lg transition-opacity"
                style={{
                  borderColor: i <= stageIdx ? "var(--action)" : "var(--hairline)",
                  opacity: i <= stageIdx ? 1 : 0.4,
                  background: i < stageIdx ? "var(--parchment)" : "white",
                }}
              >
                <span>{i < stageIdx ? "✅" : i === stageIdx ? "⏳" : "⬜"}</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "results" && (
        <section className="mt-8">
          <div className="rounded-2xl bg-[var(--parchment)] p-5">
            {results.length > 0 ? (
              <p className="text-lg">
                해당될 만한 복지 <b className="text-2xl" style={{ color: "var(--action)" }}>{results.length}개</b>를 찾았어요.
                {possibleCount > 0 && <> 그중 <b style={{ color: "var(--ok)" }}>{possibleCount}개</b>는 가능성이 높아요.</>}
              </p>
            ) : (
              <p className="text-lg">
                입력하신 상황에 <b>딱 맞는 복지를 찾지 못했어요.</b> 조건을 바꿔 다시 찾아보거나, 주민센터(129)에 문의해보세요.
              </p>
            )}
            {excluded > 0 && (
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                검토했지만 조건이 맞지 않아 {excluded}개는 제외했어요.
              </p>
            )}
            <p className="mt-2 text-sm font-medium" style={{ color: source === "live" ? "var(--ok)" : "var(--ink-soft)" }}>
              {source === "live" ? "🟢 공공데이터 실시간 + AI 분석 결과" : "⚪ 사전 데이터 기반 안내 (오프라인 모드)"}
            </p>
            {source === "cache" && reason && (
              <p className="mt-1 text-xs" style={{ color: "#cc3300" }}>원인: {reason}</p>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-4">
            {results.map((r) => (
              <ResultCard
                key={r.program.id}
                r={r}
                onDetail={() => { setSelected(r); setStep("detail"); }}
              />
            ))}
          </div>

          <button onClick={() => { stopSpeaking(); setStep("questions"); }} className="focus-ring mt-6 rounded-xl border border-[var(--hairline)] px-5 py-3 font-semibold">
            ← 조건 다시 입력
          </button>
        </section>
      )}

      {step === "detail" && selected && (
        <DetailView r={selected} onBack={() => setStep("results")} />
      )}
    </div>
  );
}

function Header({ onReset }: { onReset: () => void }) {
  return (
    <header className="sticky top-0 z-10 -mx-5 flex items-center justify-between border-b border-[var(--hairline)] bg-white/90 px-5 py-4 backdrop-blur">
      <button onClick={onReset} className="text-xl font-semibold tracking-tight">
        복지<span style={{ color: "var(--action)" }}>한입</span>
      </button>
      <span className="text-sm text-[var(--ink-soft)]">로그인 없이 · 30초</span>
    </header>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <p className="text-lg font-semibold">{label}</p>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring rounded-xl border-2 px-4 py-3 text-lg font-medium"
      style={{
        borderColor: active ? "var(--action)" : "var(--hairline)",
        background: active ? "var(--action)" : "white",
        color: active ? "white" : "var(--ink)",
      }}
    >
      {children}
    </button>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span className="whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold" style={{ background: s.bg, color: s.fg }}>
      {verdict === "가능" ? "🟢" : verdict === "불확실" ? "🟡" : "⚪"} {s.label}
    </span>
  );
}

function ResultCard({ r, onDetail }: { r: MatchedResult; onDetail: () => void }) {
  const [showReason, setShowReason] = useState(false);
  return (
    <article className="rounded-2xl border border-[var(--hairline)] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-semibold">{r.program.name}</h3>
        <VerdictBadge verdict={r.verdict} />
      </div>
      <p className="mt-2 text-[var(--ink)]">{r.program.summary}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => speak(`${r.program.name}. ${r.program.easyCache.easy}`)} className="focus-ring rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-semibold">
          🔊 듣기
        </button>
        <button onClick={() => stopSpeaking()} className="focus-ring rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-semibold">
          ⏹ 멈춤
        </button>
        <button onClick={() => setShowReason((v) => !v)} className="focus-ring rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-semibold">
          왜 되나요?
        </button>
        <button onClick={() => { stopSpeaking(); onDetail(); }} className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: "var(--action)" }}>
          자세히 · 신청준비 →
        </button>
      </div>

      {showReason && (
        <div className="mt-3 rounded-xl bg-[var(--parchment)] p-4 text-[15px] leading-relaxed">
          <p className="mb-2 text-sm font-bold" style={{ color: "var(--action)" }}>왜 해당될까요?</p>
          <p><Rich text={r.reason} /></p>
          {r.missing.length > 0 && (
            <p className="mt-2 text-[var(--ink-soft)]">확인이 필요해요: {r.missing.join(", ")}</p>
          )}
          <p className="mt-3 text-xs text-[var(--ink-soft)]">📋 공공데이터(복지로) 선정기준에 근거한 AI 분석</p>
        </div>
      )}
    </article>
  );
}

function DetailView({ r, onBack }: { r: MatchedResult; onBack: () => void }) {
  const p = r.program;
  const [checked, setChecked] = useState<boolean[]>(p.documents.map(() => false));
  return (
    <section className="mt-8">
      <button onClick={() => { stopSpeaking(); onBack(); }} className="focus-ring mb-4 rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-semibold">← 목록</button>

      <div className="flex items-start justify-between gap-3">
        <h2 className="text-2xl font-semibold">{p.name}</h2>
        <VerdictBadge verdict={r.verdict} />
      </div>

      <div className="mt-4 rounded-2xl bg-[var(--parchment)] p-5">
        <div className="flex items-center justify-between">
          <p className="font-semibold">쉬운 설명</p>
          <div className="flex gap-2">
            <button onClick={() => speak(p.easyCache.easy)} className="focus-ring rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm font-semibold">🔊 듣기</button>
            <button onClick={() => stopSpeaking()} className="focus-ring rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm font-semibold">⏹ 멈춤</button>
          </div>
        </div>
        <p className="mt-2 text-lg leading-relaxed">{p.easyCache.easy}</p>
      </div>

      <Block title="얼마나 받나요?">{p.benefit}</Block>

      <div className="mt-5">
        <p className="text-lg font-semibold">지금 할 일</p>
        <ul className="mt-2 flex flex-col gap-2">
          {p.easyCache.todo.map((t, i) => (
            <li key={i} className="rounded-xl border border-[var(--hairline)] bg-white px-4 py-3">✅ {t}</li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <p className="text-lg font-semibold">준비 서류</p>
        <ul className="mt-2 flex flex-col gap-2">
          {p.documents.map((d, i) => (
            <li key={i}>
              <button
                onClick={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
                className="focus-ring flex w-full items-center gap-3 rounded-xl border border-[var(--hairline)] bg-white px-4 py-3 text-left"
              >
                <span className="text-xl">{checked[i] ? "☑️" : "⬜"}</span>
                <span style={{ textDecoration: checked[i] ? "line-through" : "none" }}>{d}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Block title="어디서 신청하나요?">{p.applyMethod}</Block>
      <Block title="신청 기한">{p.deadline}</Block>

      <div className="mt-6 rounded-2xl border-2 p-5" style={{ borderColor: "var(--action)" }}>
        <p className="text-lg font-semibold">바로 연결</p>
        <p className="mt-1 text-[var(--ink-soft)]">{p.contact}</p>
        <a
          href={p.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="focus-ring mt-3 inline-block rounded-xl px-5 py-3 text-lg font-semibold text-white"
          style={{ background: "var(--action)" }}
        >
          신청처 바로가기 →
        </a>
      </div>

      <p className="mt-4 text-sm text-[var(--ink-soft)]">
        ※ 이 안내는 가능성 안내예요. 최종 자격은 주민센터·복지로에서 확인됩니다.
      </p>
    </section>
  );
}

// **굵게** 표시를 <strong>으로 렌더링
function Rich({ text }: { text: string }) {
  const parts = (text || "").split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} style={{ color: "var(--ink)" }}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 leading-relaxed">{children}</p>
    </div>
  );
}
