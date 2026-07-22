"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EmbeddingBackend, FitReport } from "@/lib/types";
import { useReadiness } from "@/components/readiness-store";
import { VerdictBanner } from "@/components/ui/VerdictBanner";
import { RequirementCard } from "@/components/ui/RequirementCard";
import { Spinner, SectionLabel } from "@/components/ui/primitives";
import { readinessBand, fitVerdict } from "@/components/ui/verdict";
import { DocumentInput } from "@/components/DocumentInput";

interface FitScoring {
  method: string;
  structured_weight: number;
  semantic_weight: number;
  embeddings_enabled: boolean;
  embedding_backend?: EmbeddingBackend;
  fallback_reason: string | null;
}
interface FitResponse {
  mock: boolean;
  report: FitReport;
  scoring: FitScoring;
  jd: { company: string | null; role_title: string | null };
  resume_skills: string[];
}

/** Compact, user-friendly transparency line — no method ids or raw JSON. */
function scoringLabel(s: FitScoring | undefined): string | null {
  if (!s) return null;
  if (s.method === "hybrid_0_25" && s.embedding_backend === "bge") {
    return "Scored using hybrid role matching with local BGE";
  }
  if (s.embedding_backend === "failed") return "Fallback scoring used; local BGE unavailable";
  if (s.embedding_backend === "mock") return "Scored using mock embedding context";
  if (s.method === "hybrid_0_25") return "Scored using hybrid role matching";
  if (s.fallback_reason) return "Fallback scoring used";
  return "Scored using rule-based matching";
}

type Phase = "empty" | "loading" | "result";

const LOADING_STEPS = [
  "Reading your resume",
  "Mapping the role's requirements",
  "Matching evidence to each requirement",
  "Prioritizing what to fix",
];

export default function FitPage() {
  const { state, hydrated, setModule, setTarget, commitTarget } = useReadiness();
  const [phase, setPhase] = useState<Phase>("empty");
  const [data, setData] = useState<FitResponse | null>(null);
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");

  // The store hydrates from localStorage after mount; fill inputs from the
  // shared target once it's ready, without clobbering anything typed here.
  useEffect(() => {
    if (!hydrated) return;
    setResume((r) => r || state.target.resumeText);
    setJd((j) => j || state.target.jdText);
  }, [hydrated, state.target.resumeText, state.target.jdText]);

  const roleName = state.target.role ?? data?.jd.role_title ?? "this role";
  const hasInputs = resume.trim().length > 0 && jd.trim().length > 0;

  async function run() {
    setPhase("loading");
    // A direct Fit-page edit can materially change the target. Invalidate
    // existing module scores first, then write back the new Fit result below.
    commitTarget({ ...state.target, resumeText: resume, jdText: jd });
    try {
      const res = await fetch("/api/fit/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: resume, jdText: jd }),
      });
      const d: FitResponse = await res.json();
      setData(d);
      setPhase("result");
      const inferredTarget: { role?: string | null; company?: string | null } = {};
      if (!state.target.role && d.jd.role_title) inferredTarget.role = d.jd.role_title;
      if (!state.target.company && d.jd.company) inferredTarget.company = d.jd.company;
      if (Object.keys(inferredTarget).length > 0) setTarget(inferredTarget);

      const matched = d.report.per_requirement.filter((r) => r.status === "matched").length;
      const gaps = d.report.per_requirement.filter((r) => r.status === "missing").length;
      setModule("fit", {
        status: "done",
        score: d.report.overall_score,
        statusLine: `${matched} matched · ${gaps} gap${gaps === 1 ? "" : "s"}`,
      });
    } catch {
      setPhase("empty");
    }
  }

  const report = data?.report;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 32px 90px", animation: "fadeIn .4s ease both" }}>
      <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-3)", textDecoration: "none", marginBottom: 22 }}>
        ← Dashboard
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--accent-tint)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>◎</div>
        <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 26, letterSpacing: "-.025em", margin: 0, color: "var(--ink)" }}>
          Resume Fit Analyzer
        </h1>
      </div>
      <p style={{ fontSize: 14, color: "var(--ink-3)", margin: "0 0 26px", paddingLeft: 46 }}>
        Your resume measured against what <b style={{ color: "var(--ink-2)", fontWeight: 600 }}>{roleName}</b> actually demands.
      </p>

      {/* EMPTY */}
      {phase === "empty" && (
        <div style={{ maxWidth: 620, margin: "20px auto 0" }}>
          <div style={{ display: "grid", gap: 14, marginBottom: 18 }}>
            <div>
              <SectionLabel style={{ marginBottom: 8 }}>Resume</SectionLabel>
              <DocumentInput
                kind="resume"
                value={resume}
                onTextChange={setResume}
                textareaLabel="Your resume text"
                placeholder="Paste your resume text…"
              />
            </div>
            <div>
              <SectionLabel style={{ marginBottom: 8 }}>Job description</SectionLabel>
              <DocumentInput
                kind="job description"
                value={jd}
                onTextChange={setJd}
                textareaLabel="Job description text"
                placeholder="Paste the job description…"
              />
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
              Or <Link href="/onboard" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>set a target role</Link> once and reuse it everywhere.
            </div>
          </div>
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 18,
              padding: "48px 40px",
              textAlign: "center",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accent-tint)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 18px" }}>◎</div>
            <h2 style={{ fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 22, margin: "0 0 8px", letterSpacing: "-.01em", color: "var(--ink)" }}>
              Ready to analyze your fit
            </h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)", margin: "0 auto 24px", maxWidth: 380 }}>
              We&apos;ll compare your resume line by line against the role&apos;s real requirements and show you exactly where you stand.
            </p>
            <button
              onClick={run}
              disabled={!hasInputs}
              style={{
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
                padding: "14px 26px",
                borderRadius: 11,
                cursor: hasInputs ? "pointer" : "not-allowed",
                opacity: hasInputs ? 1 : 0.5,
                boxShadow: "0 6px 18px rgba(75,70,201,.26)",
              }}
            >
              Run analysis
            </button>
            <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 16 }}>Takes a few seconds</div>
          </div>
        </div>
      )}

      {/* LOADING */}
      {phase === "loading" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: "52px 40px", boxShadow: "var(--shadow-sm)", maxWidth: 560, margin: "20px auto 0", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <Spinner />
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 20px", color: "var(--ink)" }}>Analyzing your fit…</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 11, maxWidth: 360, margin: "0 auto", textAlign: "left" }}>
            {LOADING_STEPS.map((s, i) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: i < 2 ? "var(--ink-2)" : "var(--ink-4)" }}>
                {i < 2 ? (
                  <span style={{ color: "var(--success)" }}>✓</span>
                ) : i === 2 ? (
                  <span style={{ width: 12, height: 12, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite", display: "inline-block" }} />
                ) : (
                  <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--line)" }} />
                )}
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RESULT */}
      {phase === "result" && report && (
        <FitResult report={report} scoring={data?.scoring} />
      )}
    </div>
  );
}

function FitResult({ report, scoring }: { report: FitReport; scoring?: FitScoring }) {
  const reqs = report.per_requirement;
  const matched = reqs.filter((r) => r.status === "matched").length;
  const partial = reqs.filter((r) => r.status === "partial").length;
  const missing = reqs.filter((r) => r.status === "missing").length;
  const band = readinessBand(report.overall_score);
  const verdict = fitVerdict(report.overall_score, matched, missing);
  const scoreLine = scoringLabel(scoring);

  const fixes = (report.recommendations.length > 0 ? report.recommendations : report.gaps).slice(0, 4);

  return (
    <>
      <VerdictBanner
        score={report.overall_score}
        suffix="fit score"
        bandLabel={band.label}
        bandColor={band.color}
        bandTint={band.tintBg}
        verdict={verdict}
      />

      {scoreLine && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            margin: "-12px 0 22px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: ".02em",
            color: "var(--ink-4)",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--secondary)" }} />
          {scoreLine}
        </div>
      )}

      <div className="fit-grid">
        {/* requirements */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <SectionLabel>Requirements</SectionLabel>
            <div style={{ flex: 1, height: 1, background: "var(--line)", minWidth: 20 }} />
            <span style={{ fontSize: 12, color: "var(--success)", fontWeight: 600 }}>{matched} matched</span>
            <span style={{ fontSize: 12, color: "var(--partial)", fontWeight: 600 }}>{partial} partial</span>
            <span style={{ fontSize: 12, color: "var(--gap)", fontWeight: 600 }}>{missing} missing</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {reqs.map((r, i) => (
              <RequirementCard key={i} requirement={r.requirement} status={r.status} evidence={r.evidence} mustHave={r.weight >= 1} />
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 9, alignItems: "flex-start", padding: "12px 14px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 11 }}>
            <span style={{ color: "var(--secondary)", fontSize: 13, marginTop: 1 }}>◆</span>
            <p style={{ fontSize: 12, lineHeight: 1.55, color: "var(--ink-3)", margin: 0 }}>
              Requirements reflect verified occupational data for this role, so your fit is measured against what the job
              truly needs — not just words shared with the posting.
            </p>
          </div>
        </div>

        {/* right rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {fixes.length > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 20, boxShadow: "var(--shadow-sm)" }}>
              <SectionLabel color="var(--accent-ink)" style={{ marginBottom: 14 }}>Fix these next</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {fixes.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 12 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 7, background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{i + 1}</div>
                    <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>{f}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.top_strengths.length > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 20, boxShadow: "var(--shadow-sm)" }}>
              <SectionLabel color="var(--success)" style={{ marginBottom: 12 }}>Your strengths</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {report.top_strengths.map((st, i) => (
                  <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, lineHeight: 1.45, color: "var(--ink-2)" }}>
                    <span style={{ color: "var(--success)", marginTop: 1 }}>✓</span>
                    {st}
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.missing_keywords.length > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 20, boxShadow: "var(--shadow-sm)" }}>
              <SectionLabel style={{ marginBottom: 12 }}>Keywords to weave in</SectionLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {report.missing_keywords.map((k, i) => (
                  <span key={i} style={{ fontSize: 12, color: "var(--ink-2)", background: "var(--surface-2)", border: "1px solid var(--line)", padding: "4px 10px", borderRadius: 999 }}>{k}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 24, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: "20px 24px", boxShadow: "var(--shadow-sm)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2, color: "var(--ink)" }}>Turn these gaps into practice</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Your fit report set the agenda — now rehearse the stories and drills that close the gaps.</div>
        </div>
        <Link href="/behavioural" style={{ flex: "none", border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, padding: "12px 20px", borderRadius: 10, cursor: "pointer", textDecoration: "none" }}>
          Start rehearsing →
        </Link>
      </div>
    </>
  );
}
