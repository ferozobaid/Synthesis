"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  BehaviouralQuestion,
  BehaviouralScore,
  BehaviouralSession,
} from "@/lib/types";
import { useReadiness } from "@/components/readiness-store";
import MicButton from "@/components/MicButton";
import { useSpeechRecognition, appendTranscript } from "@/components/useSpeechRecognition";
import { ReadinessRing } from "@/components/ui/ReadinessRing";
import { VerdictBanner } from "@/components/ui/VerdictBanner";
import { Spinner, SectionLabel, MeterBar } from "@/components/ui/primitives";
import { to100, readinessBand } from "@/components/ui/verdict";

interface StartResult {
  session: BehaviouralSession;
  questions: BehaviouralQuestion[];
  jd: { company: string | null; role_title: string | null } | null;
  mock: boolean;
}
interface TurnResult {
  session: BehaviouralSession;
  score: BehaviouralScore;
  matched_answer: { id: string; question: string } | null;
  match_score: number | null;
  mock: boolean;
}
interface SummaryResult {
  overall: number;
  dimension_averages: { dimension: string; average: number }[];
  answered: number;
  feedback: { summary: string; next_focus: string[] };
}

async function postBehavioural<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/behavioural", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const STAR = [
  { k: "S · SITUATION", v: "Set the scene & stakes" },
  { k: "T · TASK", v: "Your responsibility" },
  { k: "A · ACTION", v: "What you did" },
  { k: "R · RESULT", v: "Quantified outcome" },
];

const DIM_COLORS = ["var(--secondary)", "var(--accent)", "var(--success)", "var(--partial)", "var(--ink)"];

export default function BehaviouralPage() {
  const router = useRouter();
  const { state, hydrated, setModule } = useReadiness();
  const startedRef = useRef(false);

  const [session, setSession] = useState<BehaviouralSession | null>(null);
  const [questions, setQuestions] = useState<BehaviouralQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [results, setResults] = useState<Record<string, TurnResult>>({});
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(true);
  const [summary, setSummary] = useState<SummaryResult | null>(null);

  const current = questions[idx];
  const currentResult = current ? results[current.id] : undefined;
  const answeredCount = Object.keys(results).length;

  // Voice input: finalised speech chunks append into the same answer box.
  const appendSpeech = useCallback((text: string) => {
    setAnswer((prev) => appendTranscript(prev, text));
  }, []);
  const {
    supported: voiceSupported,
    listening,
    status: voiceStatus,
    interimTranscript,
    message: voiceMessage,
    start: startVoice,
    stop: stopVoice,
  } = useSpeechRecognition({ onFinalResult: appendSpeech });
  const voiceStatusMessage = listening
    ? interimTranscript || "Listening…"
    : voiceMessage ?? "Manual typing is available; voice input appends dictated text.";
  const voiceStatusIsAlert =
    voiceStatus === "permission_denied" ||
    voiceStatus === "unsupported" ||
    voiceStatus === "no_speech" ||
    voiceStatus === "recognition_error";

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const d = await postBehavioural<StartResult>({ action: "start", jdText: state.target.jdText });
      setSession(d.session);
      setQuestions(d.questions);
      setIdx(0);
      setAnswer("");
      setResults({});
      setSummary(null);
    } finally {
      setStarting(false);
    }
  }, [state.target.jdText]);

  // Wait for the store to hydrate so the session is built from the target JD.
  useEffect(() => {
    if (!hydrated || startedRef.current) return;
    startedRef.current = true;
    start();
  }, [hydrated, start]);

  async function submit() {
    if (!session || !current) return;
    stopVoice();
    setLoading(true);
    try {
      const d = await postBehavioural<TurnResult>({ action: "respond", session, questionId: current.id, answer });
      setSession(d.session);
      setResults((r) => ({ ...r, [current.id]: d }));
      setModule("behavioural", { status: "in_progress" });
    } finally {
      setLoading(false);
    }
  }

  function next() {
    stopVoice();
    setIdx((i) => Math.min(i + 1, questions.length - 1));
    setAnswer("");
  }

  async function finish() {
    if (!session) return;
    stopVoice();
    setLoading(true);
    try {
      const d = await postBehavioural<SummaryResult>({ action: "summary", session });
      setSummary(d);
      setModule("behavioural", {
        status: "done",
        score: to100(d.overall),
        statusLine: `${d.answered} answer${d.answered === 1 ? "" : "s"} coached`,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 32px 90px", animation: "fadeIn .4s ease both" }}>
      <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-3)", textDecoration: "none", marginBottom: 22 }}>
        ← Dashboard
      </Link>

      {starting ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "60px 0" }}>
          <Spinner />
          <div style={{ fontSize: 14, color: "var(--ink-3)" }}>Preparing your questions…</div>
        </div>
      ) : summary ? (
        <SummaryView summary={summary} onDone={() => router.push("/dashboard")} />
      ) : current ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--secondary-tint)", color: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◈</div>
            <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 24, letterSpacing: "-.025em", margin: 0, color: "var(--ink)" }}>Behavioural Coach</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 22px" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
              Question {idx + 1} of {questions.length}
            </span>
            <MeterBar value={((idx + 1) / questions.length) * 100} color="var(--secondary)" height={6} />
            <span style={{ fontSize: 11, color: "var(--ink-4)", whiteSpace: "nowrap" }}>{answeredCount} answered</span>
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: "24px 26px", boxShadow: "var(--shadow-md)" }}>
            <SectionLabel style={{ marginBottom: 10 }}>{current.competency || "Interviewer asks"}</SectionLabel>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: 21, fontWeight: 600, lineHeight: 1.35, margin: "0 0 20px", letterSpacing: "-.02em", color: "var(--ink)" }}>
              {current.question}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {STAR.map((s) => (
                <div key={s.k} style={{ flex: "1 1 120px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".06em", color: "var(--secondary)", fontWeight: 600, marginBottom: 2 }}>{s.k}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.35 }}>{s.v}</div>
                </div>
              ))}
            </div>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer using the STAR structure above…"
              aria-label="Your behavioural answer"
              style={{ width: "100%", height: 150, resize: "vertical", border: "1px solid var(--line)", borderRadius: 11, padding: "14px 15px", fontSize: 14, lineHeight: 1.6, color: "var(--ink)", background: "var(--surface-2)", outline: "none" }}
            />

            {/* Voice input: appends into the same answer box; typing always works. */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <MicButton
                supported={voiceSupported}
                listening={listening}
                status={voiceStatus}
                onStart={startVoice}
                onStop={stopVoice}
              />
              <span
                role={voiceStatusIsAlert ? "alert" : undefined}
                aria-live={voiceStatusIsAlert ? "assertive" : "polite"}
                style={{
                  fontSize: 12,
                  fontStyle: listening && interimTranscript ? "italic" : "normal",
                  color: voiceStatusIsAlert ? "var(--partial)" : "var(--ink-3)",
                  maxWidth: 520,
                  lineHeight: 1.45,
                }}
              >
                {voiceStatusMessage}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
              <button
                onClick={submit}
                disabled={loading || !answer.trim()}
                style={{ border: "none", background: "var(--secondary)", color: "#fff", fontSize: 14, fontWeight: 600, padding: "12px 22px", borderRadius: 10, cursor: loading || !answer.trim() ? "not-allowed" : "pointer", opacity: loading || !answer.trim() ? 0.5 : 1 }}
              >
                {loading ? "Scoring…" : currentResult ? "Re-score" : "Get coaching"}
              </button>
              {idx < questions.length - 1 && (
                <button onClick={next} style={ghostBtn}>Next question →</button>
              )}
              {answeredCount > 0 && (
                <button onClick={finish} disabled={loading} style={ghostBtn}>Finish &amp; see report →</button>
              )}
            </div>
          </div>

          {currentResult && <CoachingCard result={currentResult} />}
        </>
      ) : null}
    </div>
  );
}

function CoachingCard({ result }: { result: TurnResult }) {
  const { score, matched_answer } = result;
  const band = readinessBand(to100(score.overall));
  const tip = score.improvements[0] ?? score.missed_key_points[0] ?? "Tighten your ending with a concrete, quantified result.";

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: "24px 26px", boxShadow: "var(--shadow-md)", marginTop: 18, animation: "fadeUp .45s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <ReadinessRing value={score.overall} max={5} size={60} strokeWidth={14} color="var(--secondary)" suffix="/5" />
        <div>
          <SectionLabel color="var(--secondary)" style={{ marginBottom: 4 }}>Coaching</SectionLabel>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.3, color: "var(--ink)" }}>{band.label}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px 26px", marginBottom: 20 }}>
        {score.dimension_scores.map((d, i) => (
          <div key={i}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{d.dimension}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: DIM_COLORS[i % DIM_COLORS.length] }}>{d.score}/5</span>
            </div>
            <MeterBar value={d.score} max={5} color={DIM_COLORS[i % DIM_COLORS.length]} height={6} />
            <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--ink-3)", marginTop: 5 }}>{d.justification}</div>
          </div>
        ))}
      </div>

      {(score.covered_key_points.length > 0 || score.missed_key_points.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 18 }}>
          <div style={{ background: "var(--success-tint)", borderRadius: 11, padding: "14px 16px" }}>
            <SectionLabel color="var(--success)" style={{ marginBottom: 9, fontSize: 9.5 }}>You covered</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {score.covered_key_points.length > 0 ? score.covered_key_points.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.4, color: "var(--ink-2)" }}><span style={{ color: "var(--success)" }}>✓</span>{c}</div>
              )) : <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>—</div>}
            </div>
          </div>
          <div style={{ background: "var(--gap-tint)", borderRadius: 11, padding: "14px 16px" }}>
            <SectionLabel color="var(--gap)" style={{ marginBottom: 9, fontSize: 9.5 }}>You missed</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {score.missed_key_points.length > 0 ? score.missed_key_points.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.4, color: "var(--ink-2)" }}><span style={{ color: "var(--gap)" }}>→</span>{m}</div>
              )) : <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>—</div>}
            </div>
          </div>
        </div>
      )}

      <div style={{ background: "var(--glow)", borderRadius: 12, padding: "16px 18px", marginBottom: matched_answer ? 16 : 0, color: "#fff", boxShadow: "0 8px 30px rgba(124,120,255,.28)" }}>
        <SectionLabel color="rgba(255,255,255,.55)" style={{ marginBottom: 7, fontSize: 9.5 }}>One thing to try next</SectionLabel>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{tip}</div>
      </div>

      {matched_answer ? (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", background: "var(--surface-2)" }}>
          <SectionLabel color="var(--accent-ink)" style={{ marginBottom: 8, fontSize: 9.5 }}>Compared against your prepared answer</SectionLabel>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)", fontStyle: "italic" }}>{matched_answer.question}</div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--ink-4)", marginTop: 4 }}>
          No model answer to compare against, so relevance isn&apos;t scored this round.
        </div>
      )}
    </div>
  );
}

function SummaryView({ summary, onDone }: { summary: SummaryResult; onDone: () => void }) {
  const score100 = to100(summary.overall);
  const band = readinessBand(score100);
  const nextFocus = summary.feedback.next_focus[0];
  return (
    <div style={{ animation: "fadeUp .5s ease both" }}>
      <SectionLabel color="var(--secondary)" style={{ marginBottom: 10, fontSize: 11, letterSpacing: ".13em" }}>Behavioural readiness report</SectionLabel>
      <VerdictBanner
        score={score100}
        suffix="of 100"
        ringColor="var(--secondary)"
        tintFrom="var(--secondary-tint)"
        bandLabel={band.label}
        bandColor={band.color}
        bandTint={band.tintBg}
        verdict={summary.feedback.summary}
      />

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: "22px 24px", boxShadow: "var(--shadow-sm)", marginBottom: 18 }}>
        <SectionLabel style={{ marginBottom: 16 }}>Across all {summary.answered} answer{summary.answered === 1 ? "" : "s"}</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {summary.dimension_averages.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, width: 150, flex: "none", color: "var(--ink)" }}>{d.dimension}</span>
              <MeterBar value={d.average} max={5} color="var(--secondary)" height={8} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--secondary)", width: 44, textAlign: "right" }}>{d.average}/5</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "var(--glow)", boxShadow: "0 10px 34px rgba(124,120,255,.3)", borderRadius: 16, padding: "20px 24px", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <SectionLabel color="rgba(255,255,255,.55)" style={{ marginBottom: 6 }}>{nextFocus ? "Focus next on" : "Report complete"}</SectionLabel>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em" }}>
            {nextFocus ?? "Keep your strongest answers sharp with another pass."}
          </div>
        </div>
        <button onClick={onDone} style={{ flex: "none", border: "none", background: "#fff", color: "#0b1020", fontSize: 14, fontWeight: 600, padding: "12px 20px", borderRadius: 10, cursor: "pointer" }}>
          Back to dashboard →
        </button>
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink-2)",
  fontSize: 14,
  fontWeight: 600,
  padding: "12px 18px",
  borderRadius: 10,
  cursor: "pointer",
};
