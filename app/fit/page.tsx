"use client";

import { useState } from "react";
import Link from "next/link";
import type { FitReport, RequirementStatus } from "@/lib/types";

const SAMPLE_RESUME = `JANE DOE
Business Analytics - jane.doe@email.com

SUMMARY
Commercial analyst with 3 years turning messy data into decisions.

EXPERIENCE
Commercial Analyst, Retail Co
- Built outlet-level reporting in SQL across 4 regions
- Automated monthly analysis in Python (pandas), cutting prep time ~6 hrs/week
- Designed Power BI dashboards used in regional sales reviews

EDUCATION
BSc, Business Analytics`;

const SAMPLE_JD = `Title: Data Analyst
Company: Tenazx Inc

We are hiring a Data Analyst. Required: strong SQL and Python or R; experience with
data visualization tools; statistical analysis. A Bachelor's degree in a quantitative
field is required. Experience with cybersecurity or financial services is a plus.`;

const STATUS_STYLE: Record<RequirementStatus, string> = {
  matched: "bg-green-100 text-green-800",
  partial: "bg-amber-100 text-amber-800",
  missing: "bg-red-100 text-red-700",
};

type FitAnalyzeResponse = {
  mock: boolean;
  report: FitReport;
  scoring?: {
    method: string;
    structured_weight: number;
    semantic_weight: number;
    embeddings_enabled: boolean;
    fallback_reason: string | null;
  };
  jd: { company: string | null; role_title: string | null };
  resume_skills: string[];
};

export default function FitPage() {
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FitAnalyzeResponse | null>(null);

  async function analyze() {
    setLoading(true);
    try {
      const res = await fetch("/api/fit/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText, jdText }),
      });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const report = data?.report;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-slate-500 hover:text-accent">Home</Link>
      <h1 className="mt-2 text-3xl font-bold">Fit Analyzer</h1>
      <p className="mt-1 text-slate-600">Paste a resume and a job description, then analyze the match.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">Resume</label>
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
            placeholder="Paste resume text..."
          />
        </div>
        <div>
          <label className="text-sm font-medium">Job description</label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
            placeholder="Paste JD text..."
          />
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={analyze}
          disabled={loading}
          className="rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Analyze fit"}
        </button>
        <button
          onClick={() => {
            setResumeText(SAMPLE_RESUME);
            setJdText(SAMPLE_JD);
          }}
          className="rounded-lg border border-slate-300 px-5 py-2 font-medium"
        >
          Load sample
        </button>
      </div>

      {report && (
        <section className="mt-10">
          {data?.mock && (
            <p className="mb-3 text-xs text-amber-600">
              Running without credentials - analysis is computed locally and grounded in the O*NET taxonomy; results
              are not saved.
            </p>
          )}
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/10 text-2xl font-bold text-accent">
              {report.overall_score}
            </div>
            <div>
              <div className="text-lg font-semibold">Overall fit</div>
              <div className="text-sm text-slate-600">
                {data?.jd.role_title ?? "Role"}{data?.jd.company ? ` - ${data.jd.company}` : ""}
              </div>
              {data?.scoring && (
                <div className="mt-1 text-xs text-slate-500">
                  Method: {data.scoring.method}
                  {data.scoring.method.startsWith("hybrid")
                    ? ` (${Math.round(data.scoring.structured_weight * 100)}% rules / ${Math.round(data.scoring.semantic_weight * 100)}% semantic)`
                    : ""}
                </div>
              )}
              {data?.scoring?.fallback_reason && (
                <div className="mt-1 text-xs text-amber-600">{data.scoring.fallback_reason}</div>
              )}
            </div>
          </div>

          {report.top_strengths.length > 0 && (
            <div className="mt-6 rounded-lg border border-green-100 bg-green-50/60 p-4">
              <h2 className="font-semibold text-green-900">Strengths</h2>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-green-800">
                {report.top_strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          <h2 className="mt-8 text-lg font-semibold">Per-requirement breakdown</h2>
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="p-3">Requirement</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {report.per_requirement.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-3">
                      {r.requirement}
                      <span className="ml-2 align-middle text-xs text-slate-400">
                        {r.weight >= 1 ? "must-have" : "nice-to-have"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500">{r.evidence ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <Panel title="Gaps" items={report.gaps} />
            <Panel title="Missing keywords" items={report.missing_keywords} />
            <Panel title="Recommendations" items={report.recommendations} />
          </div>
        </section>
      )}
    </main>
  );
}

function Panel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-600">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}
