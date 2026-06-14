"use client";

import { useState } from "react";
import Link from "next/link";

const CASES = [
  { id: "beautify", title: "Beautify — Virtual Beauty Advisors" },
  { id: "diconsa", title: "Diconsa — Financial Services for Rural Mexico" },
];

interface Msg {
  role: "interviewer" | "candidate";
  text: string;
  action?: string;
  exhibit?: { title?: string; data?: unknown } | null;
}

const ACTION_STYLE: Record<string, string> = {
  advance: "bg-green-100 text-green-800",
  probe: "bg-blue-100 text-blue-800",
  redirect: "bg-indigo-100 text-indigo-800",
  hint: "bg-amber-100 text-amber-800",
  reveal: "bg-purple-100 text-purple-800",
};

export default function CasePage() {
  const [caseId, setCaseId] = useState("beautify");
  const [session, setSession] = useState<unknown>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState("");
  const [complete, setComplete] = useState(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);

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
      setStarted(true);
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
      setMsgs((m) => [
        ...m,
        { role: "interviewer", text: d.interviewer.text, action: d.decision?.action, exhibit: d.interviewer.exhibit ?? null },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-slate-500 hover:text-accent">← Home</Link>
      <h1 className="mt-2 text-3xl font-bold">Case Simulator</h1>
      <p className="mt-1 text-slate-600">An adaptive interviewer that probes, drips data, and gives graduated hints.</p>

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
          <div className="mt-4 flex items-center gap-2 text-sm">
            <span className="text-slate-500">Stage:</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">{stage}</span>
            {complete && <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800">complete</span>}
          </div>

          <div className="mt-4 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "candidate" ? "flex justify-end" : ""}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${m.role === "candidate" ? "bg-accent text-white" : "border border-slate-200 bg-white"}`}>
                  {m.action && (
                    <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[m.action] ?? "bg-slate-100"}`}>{m.action}</span>
                  )}
                  <div>{m.text}</div>
                  {m.exhibit && (
                    <pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
                      {JSON.stringify(m.exhibit, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>

          {complete ? (
            <div className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              Case complete — the scoring stage produces a rubric-based evaluation
              (structure / hypothesis / quant / synthesis / communication).
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
                className="flex-1 rounded-lg border border-slate-300 p-3 text-sm" placeholder="Your response… (⌘/Ctrl+Enter to send)" />
              <button onClick={send} disabled={loading || !input.trim()}
                className="rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-50">Send</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
