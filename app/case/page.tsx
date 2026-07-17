"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CASE_STATES, type CaseScore, type CaseState } from "@/lib/types";
import { useReadiness } from "@/components/readiness-store";
import CaseVoiceInterview from "@/components/CaseVoiceInterview";
import { StageTracker } from "@/components/ui/StageTracker";
import { ChatBubble } from "@/components/ui/ChatBubble";
import { ExhibitCard } from "@/components/ui/ExhibitCard";
import { VerdictBanner } from "@/components/ui/VerdictBanner";
import { SectionLabel, MeterBar } from "@/components/ui/primitives";
import { to100, readinessBand } from "@/components/ui/verdict";

const CASES = [
  { id: "beautify", title: "Beautify — Virtual Beauty Advisors" },
  { id: "diconsa", title: "Diconsa — Financial Services for Rural Mexico" },
];

const STAGE_LABEL: Record<CaseState, string> = {
  intro: "Intro",
  clarification: "Clarify",
  framework: "Framework",
  analysis: "Analysis",
  data_reveal: "Data",
  pressure_test: "Pressure",
  recommendation: "Recommend",
  scoring: "Score",
};

// Interviewer intent → plain-language label. FSM action names never surface.
const ACTION_LABEL: Record<string, string> = {
  reveal: "New exhibit",
  hint: "Hint",
  pressure_test: "Pressure test",
};

interface Exhibit {
  title?: string;
  synthesized?: boolean;
  insights?: string[];
  data?: unknown;
  [k: string]: unknown;
}
interface Msg {
  role: "interviewer" | "candidate";
  text: string;
  label?: string;
}

export default function CasePage() {
  const router = useRouter();
  const { setModule } = useReadiness();
  const [caseId, setCaseId] = useState("beautify");
  const [session, setSession] = useState<unknown>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [exhibits, setExhibits] = useState<Exhibit[]>([]);
  const [input, setInput] = useState("");
  const [scratch, setScratch] = useState("");
  const [stage, setStage] = useState<CaseState>("intro");
  const [complete, setComplete] = useState(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState<CaseScore | null>(null);
  const [interviewMode, setInterviewMode] = useState<"manual" | "voice">("manual");
  const [voiceScore, setVoiceScore] = useState<CaseScore | null>(null);

  const caseTitle = CASES.find((c) => c.id === caseId)?.title ?? "Case";
  const currentIdx = CASE_STATES.indexOf(stage);

  async function start() {
    setLoading(true);
    try {
      const res = await fetch("/api/case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", caseId }),
      });
      const d = await res.json();
      setSession(d.session);
      setStage(d.stage);
      setComplete(false);
      setScore(null);
      setStarted(true);
      setExhibits([]);
      setMsgs([{ role: "interviewer", text: d.interviewer.text }]);
      setModule("case", { status: "in_progress" });
    } finally {
      setLoading(false);
    }
  }

  function completeVoiceInterview(finalScore: CaseScore) {
    setVoiceScore(finalScore);
    setModule("case", {
      status: "done",
      score: to100(finalScore.overall),
      statusLine: "1 voice case · full report",
    });
  }

  async function send() {
    if (!input.trim() || loading) return;
    const answer = input;
    setMsgs((m) => [...m, { role: "candidate", text: answer }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "respond", caseId, session, answer }),
      });
      const d = await res.json();
      setSession(d.session);
      setStage(d.stage);
      setComplete(d.complete);
      const action: string | undefined = d.decision?.action;
      setMsgs((m) => [...m, { role: "interviewer", text: d.interviewer.text, label: action ? ACTION_LABEL[action] : undefined }]);
      const ex: Exhibit | null = d.interviewer?.exhibit ?? null;
      if (ex) setExhibits((list) => [...list, ex]);
      if (d.score) {
        const s = d.score as CaseScore;
        setScore(s);
        setModule("case", {
          status: "done",
          score: to100(s.overall),
          statusLine: "1 case · full report",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 32px 40px", animation: "fadeIn .4s ease both" }}>
      <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-3)", textDecoration: "none", marginBottom: 22 }}>
        ← Dashboard
      </Link>

      {voiceScore ? (
        <CaseReport score={voiceScore} onDone={() => router.push("/dashboard")} />
      ) : !started ? (
        <div style={{ maxWidth: interviewMode === "voice" ? 1120 : 520, margin: "10px auto 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--neutral-tint)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◆</div>
            <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 24, letterSpacing: "-.025em", margin: 0, color: "var(--ink)" }}>Case Coach</h1>
          </div>
          <div style={{ maxWidth: 520, margin: "0 auto", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 22, boxShadow: "var(--shadow-sm)" }}>
            <SectionLabel style={{ marginBottom: 10 }}>Choose a case</SectionLabel>
            <select
              value={caseId}
              onChange={(e) => {
                const nextCaseId = e.target.value;
                setCaseId(nextCaseId);
                if (nextCaseId !== "beautify") setInterviewMode("manual");
              }}
              aria-label="Choose a case"
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 12px", fontSize: 14, color: "var(--ink)", background: "var(--surface-2)", outline: "none" }}
            >
              {CASES.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>

            <SectionLabel style={{ margin: "18px 0 10px" }}>Interview format</SectionLabel>
            <div
              role="group"
              aria-label="Interview format"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 4, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface-2)" }}
            >
              <button
                type="button"
                onClick={() => setInterviewMode("manual")}
                aria-pressed={interviewMode === "manual"}
                style={modeButton(interviewMode === "manual")}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => setInterviewMode("voice")}
                disabled={caseId !== "beautify"}
                aria-pressed={interviewMode === "voice"}
                title={caseId === "beautify" ? "" : "Live voice is available for Beautify only"}
                style={modeButton(interviewMode === "voice", caseId !== "beautify")}
              >
                Live voice
              </button>
            </div>

            {interviewMode === "manual" && (
              <button
                onClick={start}
                disabled={loading}
                style={{ marginTop: 16, border: "none", background: "var(--accent)", color: "#fff", fontSize: 15, fontWeight: 600, padding: "13px 24px", borderRadius: 11, cursor: "pointer", boxShadow: "0 6px 18px rgba(75,70,201,.26)" }}
              >
                {loading ? "Starting…" : "Start case"}
              </button>
            )}
          </div>

          {interviewMode === "voice" && (
            <CaseVoiceInterview caseId={caseId} onComplete={completeVoiceInterview} />
          )}
        </div>
      ) : complete && score ? (
        <CaseReport score={score} onDone={() => router.push("/dashboard")} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--neutral-tint)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◆</div>
            <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 24, letterSpacing: "-.025em", margin: 0, color: "var(--ink)" }}>Case Coach</h1>
            <span style={{ fontSize: 13, color: "var(--ink-3)", marginLeft: "auto" }}>{caseTitle}</span>
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 20px", boxShadow: "var(--shadow-sm)", marginBottom: 18, overflowX: "auto" }}>
            <StageTracker stages={CASE_STATES.map((s) => STAGE_LABEL[s])} currentIdx={currentIdx} complete={complete} />
          </div>

          <div className="case-grid">
            {/* chat */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "var(--shadow-md)", display: "flex", flexDirection: "column", height: 560, minWidth: 0 }}>
              <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>◆</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.1, color: "var(--ink)" }}>Your interviewer</div>
                  <div style={{ fontSize: 11, color: "var(--ink-4)" }}>Case partner</div>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                {msgs.map((m, i) => (
                  <ChatBubble key={i} role={m.role} text={m.text} label={m.label} />
                ))}
                {loading && <div style={{ fontSize: 12, color: "var(--ink-4)", fontStyle: "italic" }}>Interviewer is thinking…</div>}
              </div>
              <div style={{ borderTop: "1px solid var(--line)", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontStyle: "italic" }}>⌘/Ctrl+Enter to send</span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
                    placeholder="Type your response…"
                    aria-label="Your response to the interviewer"
                    style={{ flex: 1, height: 64, resize: "none", border: "1px solid var(--line)", borderRadius: 11, padding: "11px 13px", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)", background: "var(--surface-2)", outline: "none" }}
                  />
                  <button
                    onClick={send}
                    disabled={loading || !input.trim()}
                    style={{ flex: "none", border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, padding: "12px 20px", borderRadius: 11, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.5 : 1, height: 44 }}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>

            {/* right rail */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-sm)" }}>
                <SectionLabel style={{ marginBottom: 10 }}>Scratchpad</SectionLabel>
                <textarea
                  value={scratch}
                  onChange={(e) => setScratch(e.target.value)}
                  placeholder="Jot structure, numbers, hypotheses…"
                  aria-label="Scratchpad"
                  style={{ width: "100%", height: 150, resize: "none", border: "1px dashed var(--line)", borderRadius: 10, padding: "11px 12px", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, color: "var(--ink-2)", background: "var(--surface-2)", outline: "none" }}
                />
              </div>

              <div>
                <SectionLabel style={{ marginBottom: 10, paddingLeft: 2 }}>Exhibits</SectionLabel>
                {exhibits.length === 0 ? (
                  <div style={{ border: "1.5px dashed var(--line)", borderRadius: 12, padding: "24px 16px", textAlign: "center", background: "var(--surface-2)" }}>
                    <div style={{ fontSize: 22, color: "var(--ink-4)", marginBottom: 6 }}>▤</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>Exhibits appear here as the interviewer shares them.</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {exhibits.map((e, i) => (
                      <ExhibitCard key={i} exhibit={e} index={i} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function modeButton(selected: boolean, disabled = false): React.CSSProperties {
  return {
    border: "none",
    borderRadius: 7,
    background: selected ? "var(--surface)" : "transparent",
    color: selected ? "var(--ink)" : "var(--ink-3)",
    boxShadow: selected ? "var(--shadow-sm)" : "none",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 12px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
}

function CaseReport({ score, onDone }: { score: CaseScore; onDone: () => void }) {
  const score100 = to100(score.overall);
  const band = readinessBand(score100);
  const verdict =
    score100 >= 65
      ? "Strong, structured performance. You separated the drivers early, used the exhibits well, and held your ground under pressure."
      : "A workable case with clear room to grow. Tighten your structure and lean harder on the exhibits to lift your score.";

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", animation: "fadeUp .5s ease both" }}>
      <SectionLabel color="var(--ink-3)" style={{ marginBottom: 10, fontSize: 11, letterSpacing: ".13em" }}>Case performance report</SectionLabel>
      <VerdictBanner
        score={score100}
        suffix="of 100"
        ringColor="var(--ink)"
        tintFrom="var(--neutral-tint)"
        bandLabel={band.label}
        bandColor={band.color}
        bandTint={band.tintBg}
        verdict={verdict}
      />

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: "22px 24px", boxShadow: "var(--shadow-sm)", marginBottom: 18 }}>
        <SectionLabel style={{ marginBottom: 16 }}>Scoring rubric</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {score.dimension_scores.map((d, i) => (
            <div key={i}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 600, width: 170, flex: "none", textTransform: "capitalize", color: "var(--ink)" }}>{d.dimension}</span>
                <MeterBar value={d.score} max={5} color="var(--accent)" height={8} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--accent)", width: 44, textAlign: "right" }}>{d.score}/5</span>
              </div>
              {d.justification && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4, paddingLeft: 0 }}>{d.justification}</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 18 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 18, boxShadow: "var(--shadow-sm)" }}>
          <SectionLabel color="var(--success)" style={{ marginBottom: 11, fontSize: 9.5 }}>What worked</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {score.strengths.length > 0 ? score.strengths.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-2)" }}><span style={{ color: "var(--success)", marginTop: 1 }}>✓</span>{c}</div>
            )) : <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>—</div>}
          </div>
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 18, boxShadow: "var(--shadow-sm)" }}>
          <SectionLabel color="var(--partial)" style={{ marginBottom: 11, fontSize: 9.5 }}>To sharpen</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {score.improvements.length > 0 ? score.improvements.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-2)" }}><span style={{ color: "var(--partial)", marginTop: 1 }}>→</span>{m}</div>
            )) : <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>—</div>}
          </div>
        </div>
      </div>

      {score.next_focus.length > 0 && (
        <div style={{ background: "var(--glow)", boxShadow: "0 10px 34px rgba(124,120,255,.3)", borderRadius: 16, padding: "20px 24px", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <SectionLabel color="rgba(255,255,255,.55)" style={{ marginBottom: 6 }}>Focus next on</SectionLabel>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.35 }}>{score.next_focus[0]}</div>
          </div>
          <button onClick={onDone} style={{ flex: "none", border: "none", background: "#fff", color: "#0b1020", fontSize: 14, fontWeight: 600, padding: "12px 20px", borderRadius: 10, cursor: "pointer" }}>
            Back to dashboard →
          </button>
        </div>
      )}
    </div>
  );
}
