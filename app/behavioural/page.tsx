"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  BehaviouralQuestion,
  BehaviouralScore,
  BehaviouralSession,
} from "@/lib/types";

const SAMPLE_JD = `Title: Entry Level Oracle Financial Technology Consultant
Company: Revature
Location: East Chicago, IN
Experience level: Entry level

What We Are Looking For:
Bachelor's degree in a business or quantitative concentration
Strong communication and interpersonal skills
A natural problem solver with an analytical mindset
Experience with SQL and data analysis is a plus`;

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

export default function BehaviouralPage() {
  const [jdText, setJdText] = useState(SAMPLE_JD);
  const [started, setStarted] = useState(false);
  const [mock, setMock] = useState(false);

  const [session, setSession] = useState<BehaviouralSession | null>(null);
  const [questions, setQuestions] = useState<BehaviouralQuestion[]>([]);
  const [jd, setJd] = useState<StartResult["jd"]>(null);

  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [results, setResults] = useState<Record<string, TurnResult>>({});
  const [loading, setLoading] = useState(false);

  const [summary, setSummary] = useState<SummaryResult | null>(null);

  const current = questions[idx];
  const currentResult = current ? results[current.id] : undefined;
  const answeredCount = Object.keys(results).length;

  async function start() {
    setLoading(true);
    try {
      const d = await postBehavioural<StartResult>({ action: "start", jdText });
      setSession(d.session);
      setQuestions(d.questions);
      setJd(d.jd);
      setMock(d.mock);
      setStarted(true);
      setIdx(0);
      setAnswer("");
      setResults({});
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!session || !current) return;
    setLoading(true);
    try {
      const d = await postBehavioural<TurnResult>({
        action: "respond",
        session,
        questionId: current.id,
        answer,
      });
      setSession(d.session);
      setResults((r) => ({ ...r, [current.id]: d }));
    } finally {
      setLoading(false);
    }
  }

  function next() {
    setIdx((i) => Math.min(i + 1, questions.length - 1));
    setAnswer("");
  }

  async function finish() {
    if (!session) return;
    setLoading(true);
    try {
      const d = await postBehavioural<SummaryResult>({ action: "summary", session });
      setSummary(d);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStarted(false);
    setSummary(null);
    setResults({});
    setIdx(0);
    setAnswer("");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-slate-500 hover:text-accent">← Home</Link>
      <h1 className="mt-2 text-3xl font-bold">Behavioural Simulator</h1>
      <p className="mt-1 text-slate-600">
        We generate questions from the job description, retrieve your prepared STAR answers,
        and score each response.
        <span className="ml-1 text-slate-400">Voice input arrives after the text path.</span>
      </p>
      {mock && (
        <p className="mt-3 text-xs text-amber-600">
          Mock mode — deterministic heuristic scoring (no credentials set).
        </p>
      )}

      {/* ---------------- Start screen ---------------- */}
      {!started && (
        <section className="mt-6">
          <label className="text-sm font-medium">
            Job description <span className="text-slate-400">(drives the &ldquo;why this company / role&rdquo; questions)</span>
          </label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
          />
          <button
            onClick={start}
            disabled={loading}
            className="mt-3 rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-50"
          >
            {loading ? "Starting…" : "Start session"}
          </button>
        </section>
      )}

      {/* ---------------- Question screen ---------------- */}
      {started && !summary && current && (
        <section className="mt-6">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Question {idx + 1} of {questions.length}</span>
            <span>{answeredCount} answered</span>
          </div>
          {jd?.company && (
            <p className="mt-1 text-xs text-slate-400">
              JD parsed: {jd.role_title ?? "role"} @ {jd.company}
            </p>
          )}

          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">{current.competency}</div>
            <div className="mt-1 text-lg font-medium">{current.question}</div>
          </div>

          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={7}
            className="mt-4 w-full rounded-lg border border-slate-300 p-3 text-sm"
            placeholder="Type your STAR answer (Situation, Task, Action, Result)…"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={submit}
              disabled={loading || !answer.trim()}
              className="rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-50"
            >
              {loading ? "Scoring…" : currentResult ? "Re-score" : "Submit answer"}
            </button>
            {idx < questions.length - 1 && (
              <button
                onClick={next}
                className="rounded-lg border border-slate-300 px-5 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Next question →
              </button>
            )}
            {answeredCount > 0 && (
              <button
                onClick={finish}
                disabled={loading}
                className="rounded-lg border border-slate-300 px-5 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Finish &amp; see summary
              </button>
            )}
          </div>

          {currentResult && <ScoreView result={currentResult} />}
        </section>
      )}

      {/* ---------------- Summary screen ---------------- */}
      {summary && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold">Session summary</h2>
          <p className="mt-1 text-slate-600">{summary.feedback.summary}</p>
          <div className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-lg font-semibold text-white">
            Overall {summary.overall} / 5
            <span className="ml-2 text-sm font-normal text-slate-300">· {summary.answered} answered</span>
          </div>

          <div className="mt-4 space-y-2">
            {summary.dimension_averages.map((d, i) => (
              <DimBar key={i} label={d.dimension} score={d.average} />
            ))}
          </div>

          {summary.feedback.next_focus.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-semibold text-amber-800">Focus next on</h3>
              <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
                {summary.feedback.next_focus.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}

          <button
            onClick={reset}
            className="mt-6 rounded-lg border border-slate-300 px-5 py-2 font-medium text-slate-700 hover:bg-slate-50"
          >
            Start over
          </button>
        </section>
      )}
    </main>
  );
}

function DimBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-slate-500">{score}/5</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(score / 5) * 100}%` }} />
      </div>
    </div>
  );
}

function ScoreView({ result }: { result: TurnResult }) {
  const { score, matched_answer, match_score } = result;
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Score: {score.overall} / 5</h3>
        {matched_answer ? (
          <span className="text-xs text-slate-500">
            Matched your prepared answer{match_score != null ? ` (match ${match_score})` : ""}
          </span>
        ) : (
          <span className="text-xs text-amber-600">No prepared answer matched — relevance not scored</span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {score.dimension_scores.map((d, i) => (
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

      {(score.covered_key_points.length > 0 || score.missed_key_points.length > 0) && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <h4 className="font-semibold text-green-800">Covered key points</h4>
            <ul className="mt-2 list-inside list-disc text-sm text-green-900">
              {score.covered_key_points.map((p, i) => <li key={i}>{p}</li>)}
              {score.covered_key_points.length === 0 && <li className="list-none text-green-700/60">—</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h4 className="font-semibold text-amber-800">Missed key points</h4>
            <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
              {score.missed_key_points.map((p, i) => <li key={i}>{p}</li>)}
              {score.missed_key_points.length === 0 && <li className="list-none text-amber-700/60">—</li>}
            </ul>
          </div>
        </div>
      )}

      {(score.strengths.length > 0 || score.improvements.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {score.strengths.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700">Strengths</h4>
              <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
                {score.strengths.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          {score.improvements.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700">Improvements</h4>
              <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
                {score.improvements.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
