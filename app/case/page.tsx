"use client";

import { useState } from "react";
import Link from "next/link";
import { CASE_STATES, type CaseScore, type CaseState } from "@/lib/types";

const CASES = [
  { id: "beautify", title: "Beautify — Virtual Beauty Advisors" },
  { id: "diconsa", title: "Diconsa — Financial Services for Rural Mexico" },
];

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
  action?: string;
  exhibit?: Exhibit | null;
}

const ACTION_STYLE: Record<string, string> = {
  advance: "bg-green-100 text-green-800",
  probe: "bg-blue-100 text-blue-800",
  redirect: "bg-indigo-100 text-indigo-800",
  hint: "bg-amber-100 text-amber-800",
  reveal: "bg-purple-100 text-purple-800",
};

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

export default function CasePage() {
  const [caseId, setCaseId] = useState("beautify");
  const [session, setSession] = useState<unknown>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<CaseState>("intro");
  const [complete, setComplete] = useState(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState<CaseScore | null>(null);
  const [mock, setMock] = useState(false);

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
      setMock(!!d.mock);
      setMsgs([{ role: "interviewer", text: d.interviewer.text }]);
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    if (!input.trim()) return;
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
      setMock(!!d.mock);
      if (d.score) setScore(d.score as CaseScore);
      setMsgs((m) => [
        ...m,
        { role: "interviewer", text: d.interviewer.text, action: d.decision?.action, exhibit: d.interviewer?.exhibit ?? null },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const currentIdx = CASE_STATES.indexOf(stage);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-slate-500 hover:text-accent">← Home</Link>
      <h1 className="mt-2 text-3xl font-bold">Case Simulator</h1>
      <p className="mt-1 text-slate-600">An adaptive interviewer that evaluates each response, probes, drips data, gives graduated hints, and scores you at the end.</p>

      {!started ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <label className="text-sm font-medium">Choose a case</label>
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm">
            {CASES.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button onClick={start} disabled={loading}
            className="mt-4 rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-50">
            {loading ? "Starting…" : "Start case"}
          </button>
        </div>
      ) : (
        <>
          {/* Stage progression */}
          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            {CASE_STATES.map((s, i) => {
              const done = i < currentIdx || complete;
              const active = i === currentIdx && !complete;
              return (
                <span key={s}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    active ? "bg-accent text-white" : done ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500"
                  }`}>
                  {STAGE_LABEL[s]}
                </span>
              );
            })}
          </div>

          {mock && (
            <p className="mt-3 text-xs text-amber-600">
              Running without credentials — responses are evaluated locally with a deterministic heuristic; nothing is saved.
            </p>
          )}

          <div className="mt-4 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "candidate" ? "flex justify-end" : ""}>
                <div className={`max-w-[88%] rounded-2xl px-4 py-2 text-sm ${m.role === "candidate" ? "bg-accent text-white" : "border border-slate-200 bg-white"}`}>
                  {m.action && (
                    <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[m.action] ?? "bg-slate-100"}`}>{m.action}</span>
                  )}
                  <div>{m.text}</div>
                  {m.exhibit && <ExhibitCard exhibit={m.exhibit} />}
                </div>
              </div>
            ))}
          </div>

          {complete && score ? (
            <ScorePanel score={score} />
          ) : !complete ? (
            <div className="mt-4 flex gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
                className="flex-1 rounded-lg border border-slate-300 p-3 text-sm" placeholder="Your response… (⌘/Ctrl+Enter to send)" />
              <button onClick={send} disabled={loading || !input.trim()}
                className="rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-50">Send</button>
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-500">Scoring…</p>
          )}
        </>
      )}
    </main>
  );
}

function ExhibitCard({ exhibit }: { exhibit: Exhibit }) {
  return (
    <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50/60 p-3 text-slate-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{exhibit.title ?? "Exhibit"}</span>
        {exhibit.synthesized && (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">synthesized</span>
        )}
      </div>
      {Array.isArray(exhibit.insights) && exhibit.insights.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-700">
          {exhibit.insights.map((ins, i) => <li key={i}>{ins}</li>)}
        </ul>
      )}
      {exhibit.data != null && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500">Raw figures</summary>
          <pre className="mt-1 max-h-56 overflow-auto rounded bg-white/70 p-2 text-[11px] text-slate-600">
            {JSON.stringify(exhibit.data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function ScorePanel({ score }: { score: CaseScore }) {
  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-accent/10 text-accent">
          <span className="text-2xl font-bold leading-none">{score.overall.toFixed(1)}</span>
          <span className="text-xs">/ 5</span>
        </div>
        <div>
          <div className="text-lg font-semibold">Case score</div>
          <div className="text-sm text-slate-600">Rubric-anchored across five dimensions</div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {score.dimension_scores.map((d) => (
          <div key={d.dimension}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium capitalize">{d.dimension}</span>
              <span className="text-slate-500">{d.score}/5</span>
            </div>
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className={`h-2 flex-1 rounded ${n <= d.score ? "bg-accent" : "bg-slate-100"}`} />
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">{d.justification}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <FeedbackList title="Strengths" items={score.strengths} tone="green" />
        <FeedbackList title="Improvements" items={score.improvements} tone="amber" />
        <FeedbackList title="Next focus" items={score.next_focus} tone="slate" />
      </div>
    </section>
  );
}

function FeedbackList({ title, items, tone }: { title: string; items: string[]; tone: "green" | "amber" | "slate" }) {
  const head = tone === "green" ? "text-green-800" : tone === "amber" ? "text-amber-800" : "text-slate-700";
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h3 className={`text-sm font-semibold ${head}`}>{title}</h3>
      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-600">
        {items.length > 0 ? items.map((it, i) => <li key={i}>{it}</li>) : <li className="list-none text-slate-400">—</li>}
      </ul>
    </div>
  );
}
