"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildPersonalizedTarget,
  useReadiness,
} from "@/components/readiness-store";
import { DocumentInput } from "@/components/DocumentInput";

/** Naive role-title guess from a pasted JD (client-only convenience). */
function guessRole(jd: string): { role: string | null; company: string | null } {
  const roleMatch = jd.match(/(?:title|role)\s*[:\-]\s*(.+)/i);
  const companyMatch = jd.match(/company\s*[:\-]\s*(.+)/i);
  return {
    role: roleMatch?.[1]?.trim() || null,
    company: companyMatch?.[1]?.trim() || null,
  };
}

export default function Onboard() {
  const router = useRouter();
  const { state, hydrated, commitTarget, seedSample } = useReadiness();
  const [roleTitle, setRoleTitle] = useState("");
  const [jd, setJd] = useState("");

  useEffect(() => {
    if (!hydrated || state.targetSource !== "personalized") return;
    setRoleTitle((current) => current || state.target.role || "");
    setJd((current) => current || state.target.jdText);
  }, [
    hydrated,
    state.target.jdText,
    state.target.role,
    state.targetSource,
  ]);

  const canContinue =
    roleTitle.trim().length > 0 && jd.trim().length > 0;

  function build() {
    if (!canContinue) return;
    const guessed = guessRole(jd);
    // commitTarget invalidates prior module scores when the role materially
    // changes, so the next analysis starts from an unstarted readiness state.
    commitTarget(
      buildPersonalizedTarget(state, {
        jdText: jd,
        role: roleTitle.trim() || guessed.role || "Your target role",
        company: guessed.company,
      }),
      "personalized",
    );
    router.push("/fit");
  }

  function trySample() {
    seedSample();
    router.push("/dashboard");
  }

  return (
    <main className="page-enter" style={{ minHeight: "100vh" }}>
      <div className="page-shell onboard-shell">
        <Link href="/" className="page-back">
          ← Back
        </Link>

        <header className="onboard-hero">
          <div className="onboard-hero__copy">
            <div className="onboard-eyebrow">Set your target role / 01</div>
            <h1 className="page-title onboard-title">Who are you preparing to be?</h1>
            <p className="onboard-description">
              Set the job you&apos;re targeting once. Resume fit, behavioural,
              and case practice will all use the same role benchmark.
            </p>
          </div>

          <aside className="onboard-brief" aria-label="Setup summary">
            <div className="onboard-brief__label">Setup / 02 inputs</div>
            <strong>One role. One readiness plan.</strong>
            <p>Your job description defines the shared bar. Resume evidence comes next.</p>
          </aside>
        </header>

        <div className="onboard-input-grid onboard-input-grid--role-only">
          <section className="surface-card onboard-card onboard-card--role">
            <div className="onboard-card__header">
              <span className="onboard-card__number" aria-hidden="true">01</span>
              <div>
                <div className="onboard-card__eyebrow">Shared role benchmark</div>
                <h2>Target job</h2>
                <p>Name the role, then paste the job description Synthesis should use across every module.</p>
              </div>
            </div>
            <label htmlFor="onboard-role" className="field-label">Role title</label>
            <input
              id="onboard-role"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="Role title — e.g. Associate Consultant"
              aria-label="Target role title"
              className="form-control"
              style={{
                width: "100%",
                padding: "12px 13px",
                fontSize: 13,
                marginBottom: 14,
              }}
            />
            <DocumentInput
              kind="job description"
              value={jd}
              onTextChange={setJd}
              textareaLabel="Target job description text"
              placeholder="Paste the full job description here…"
              height={158}
            />
          </section>
        </div>

        <footer className="onboard-actions">
          <div className="onboard-actions__note">
            <div className="onboard-actions__label">Grounded role analysis</div>
            <p>
              Next, add your resume to measure your evidence against this role.
              You can change the shared target at any time.
            </p>
          </div>
          <div className="onboard-actions__buttons">
            <button
              onClick={build}
              disabled={!canContinue}
              className="app-button app-button--primary"
            >
              Continue to resume analysis →
            </button>
            <button onClick={trySample} className="app-button app-button--secondary">
              <span className="onboard-actions__dot" />
              View sample readiness plan
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
