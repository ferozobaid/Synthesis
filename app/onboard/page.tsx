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
    <div style={{ minHeight: "100vh", background: "var(--paper)", animation: "fadeIn .4s ease both" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "44px 32px 80px" }}>
        <Link
          href="/"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-3)", textDecoration: "none", marginBottom: 34 }}
        >
          ← Back
        </Link>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent-ink)", marginBottom: 12 }}>
          Set your target role
        </div>
        <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 34, letterSpacing: "-.03em", margin: "0 0 12px", lineHeight: 1.08, color: "var(--ink)" }}>
          Who are you preparing to be?
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--ink-2)", margin: "0 0 34px", maxWidth: 560 }}>
          Give us your resume and the job you&apos;re targeting. Everything Synthesis coaches — fit, behavioural, and
          case — is tuned to this role.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {/* resume */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 22, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--accent-tint)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>◎</div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>Your resume</span>
            </div>
            <DocumentInput
              kind="resume"
              value={resume}
              onTextChange={setResume}
              textareaLabel="Your resume text"
              placeholder="…paste your resume text here"
            />
          </div>

          {/* target job */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 22, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--secondary-tint)", color: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>◈</div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>Target job</span>
            </div>
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="Role title — e.g. Associate Consultant"
              aria-label="Target role title"
              style={{
                width: "100%",
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: "11px 12px",
                fontSize: 13,
                color: "var(--ink)",
                background: "var(--surface)",
                outline: "none",
                marginBottom: 10,
              }}
            />
            <DocumentInput
              kind="job description"
              value={jd}
              onTextChange={setJd}
              textareaLabel="Target job description text"
              placeholder="Paste the job description"
              height={104}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 26, flexWrap: "wrap" }}>
          <button
            onClick={build}
            style={{
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              padding: "14px 26px",
              borderRadius: 11,
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(75,70,201,.26)",
            }}
          >
            Build my readiness dashboard →
          </button>
          <button
            onClick={trySample}
            style={{
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink)",
              fontSize: 14,
              fontWeight: 600,
              padding: "14px 20px",
              borderRadius: 11,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--secondary)" }} />
            Try a sample candidate
          </button>
        </div>

        <div style={{ marginTop: 22, display: "flex", gap: 9, alignItems: "flex-start", maxWidth: 560 }}>
          <div style={{ color: "var(--ink-4)", fontSize: 13, marginTop: 1 }}>ⓘ</div>
          <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-3)", margin: 0 }}>
            Requirements are checked against real occupational data for this role, so your fit reflects what the job
            actually demands — not just keyword overlap.
          </p>
        </div>
      </div>
    </div>
  );
}
