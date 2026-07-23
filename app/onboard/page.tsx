"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReadiness } from "@/components/readiness-store";
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
  const { commitTarget, seedSample } = useReadiness();
  const [resume, setResume] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jd, setJd] = useState("");

  function build() {
    const guessed = guessRole(jd);
    // commitTarget invalidates prior module scores when the role materially
    // changes, so the new dashboard starts from an unstarted readiness state.
    commitTarget({
      resumeText: resume,
      jdText: jd,
      role: roleTitle.trim() || guessed.role || "Your target role",
      company: guessed.company,
    });
    router.push("/dashboard");
  }

  function trySample() {
    seedSample();
    router.push("/dashboard");
  }

  return (
    <main style={{ minHeight: "100vh", animation: "fadeIn .4s ease both" }}>
      <div className="page-shell onboard-shell">
        <Link href="/" className="page-back">
          ← Back
        </Link>

        <header className="onboard-hero">
          <div className="onboard-hero__copy">
            <div className="onboard-eyebrow">Set your target role / 01</div>
            <h1 className="page-title onboard-title">Who are you preparing to be?</h1>
            <p className="onboard-description">
              Give us your resume and the job you&apos;re targeting. Everything Synthesis coaches — fit, behavioural,
              and case — is tuned to this role.
            </p>
          </div>

          <aside className="onboard-brief" aria-label="Setup summary">
            <div className="onboard-brief__label">Setup / 02 inputs</div>
            <strong>One role. One readiness plan.</strong>
            <p>Your resume shows your evidence. The job description defines the bar.</p>
          </aside>
        </header>

        <div className="onboard-input-grid">
          {/* resume */}
          <section className="surface-card onboard-card onboard-card--resume">
            <div className="onboard-card__header">
              <span className="onboard-card__number" aria-hidden="true">01</span>
              <div>
                <div className="onboard-card__eyebrow">Candidate evidence</div>
                <h2>Your resume</h2>
                <p>Upload your latest resume, or paste the text manually.</p>
              </div>
            </div>
            <DocumentInput
              kind="resume"
              value={resume}
              onTextChange={setResume}
              textareaLabel="Your resume text"
              placeholder="Or paste your complete resume text here…"
              height={148}
            />
          </section>

          {/* target job */}
          <section className="surface-card onboard-card onboard-card--role">
            <div className="onboard-card__header">
              <span className="onboard-card__number" aria-hidden="true">02</span>
              <div>
                <div className="onboard-card__eyebrow">Role benchmark</div>
                <h2>Target job</h2>
                <p>Name the role, then paste the job description as your primary input.</p>
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
              Requirements are checked against real occupational data for this role, so your fit reflects what the job
              actually demands — not just keyword overlap.
            </p>
          </div>
          <div className="onboard-actions__buttons">
            <button onClick={build} className="app-button app-button--primary">
              Build my readiness dashboard →
            </button>
            <button onClick={trySample} className="app-button app-button--secondary">
              <span className="onboard-actions__dot" />
              Try a sample candidate
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
