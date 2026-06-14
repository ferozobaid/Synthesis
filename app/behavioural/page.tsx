"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BehaviouralQuestion, BehaviouralScore } from "@/lib/types";

interface ScoreResult {
  mock: boolean;
  score: BehaviouralScore;
  matched_answer: { id: string; question: string } | null;
  match_score: number | null;
}

export default function BehaviouralPage() {
  const [questions, setQuestions] = useState<BehaviouralQuestion[]>([]);
  const [company, setCompany] = useState("Tenazx Inc");
  const [qid, setQid] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScoreResult | null>(null);

  async function loadQuestions(c: string) {
    const res = await fetch("/api/behavioural", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "questions", company: c }),
    });
    const d = await res.json();
    setQuestions(d.questions);
    setQid((prev) => prev || d.questions?.[0]?.id || "");
  }

  useEffect(() => {
    loadQuestions(company);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = questions.find((q) => q.id === qid);

  async function score() {
    setLoading(true);
    try {
      const res = await fetch("/api/behavioural", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "score", questionId: qid, answer }),
      });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-slate-500 hover:text-accent">← Home</Link>
      <h1 className="mt-2 text-3xl font-bold">Behavioural Simulator</h1>
      <p className="mt-1 text-slate-600">
        Answer a behavioural question; we score it against your prepared STAR answers.
        <span className="ml-1 text-slate-400">Voice input arrives after the text path.</span>
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">Target company (for &ldquo;why this company&rdquo;)</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} onBlur={() => loadQuestions(company)}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
        </div>
        <div>
          <label className="text-sm font-medium">Question</label>
          <select value={qid} onChange={(e) => setQid(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm">
            {questions.map((q) => <option key={q.id} value={q.id}>{q.question}</option>)}
          </select>
        </div>
      </div>

      {current && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">{current.competency}</div>
          <div className="mt-1 text-lg font-medium">{current.question}</div>
        </div>
      )}

      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={7}
        className="mt-4 w-full rounded-lg border border-slate-300 p-3 text-sm" placeholder="Speak (later) or type your STAR answer…" />

      <button onClick={score} disabled={loading || !answer.trim()}
        className="mt-3 rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-50">
        {loading ? "Scoring…" : "Score answer"}
      </button>

      {result && (
        <section className="mt-8">
          {result.mock && <p className="mb-3 text-xs text-amber-600">Mock mode — representative scoring (no credentials set).</p>}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Score: {result.score.overall} / 5</h2>
            {result.matched_answer && (
              <span className="text-xs text-slate-500">
                Matched your prepared answer{result.match_score != null ? ` (sim ${result.match_score})` : ""}
              </span>
            )}
          </div>

          <div className="mt-3 space-y-2">
            {result.score.dimension_scores.map((d, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{d.dimension}</span>
                  <span className="text-slate-500">{d.score}/5</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(d.score / 5) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{d.justification}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <h3 className="font-semibold text-green-800">Covered key points</h3>
              <ul className="mt-2 list-inside list-disc text-sm text-green-900">
                {result.score.covered_key_points.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-semibold text-amber-800">Missed key points</h3>
              <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
                {result.score.missed_key_points.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
