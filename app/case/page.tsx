"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CaseScore } from "@/lib/types";
import { useReadiness } from "@/components/readiness-store";
import CaseVoiceInterview from "@/components/CaseVoiceInterview";
import { VerdictBanner } from "@/components/ui/VerdictBanner";
import { SectionLabel, MeterBar } from "@/components/ui/primitives";
import { to100, readinessBand } from "@/components/ui/verdict";

export default function CasePage() {
  const router = useRouter();
  const { setModule } = useReadiness();
  const [voiceScore, setVoiceScore] = useState<CaseScore | null>(null);

  function completeVoiceInterview(finalScore: CaseScore) {
    setVoiceScore(finalScore);
    setModule("case", {
      status: "done",
      score: to100(finalScore.overall),
      statusLine: "1 voice case · full report",
    });
  }

  return (
    <div
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "32px clamp(16px, 4vw, 32px) 40px",
        animation: "fadeIn .4s ease both",
      }}
    >
      <Link
        href="/dashboard"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontSize: 13,
          color: "var(--ink-3)",
          textDecoration: "none",
          marginBottom: 22,
        }}
      >
        ← Dashboard
      </Link>

      {voiceScore ? (
        <CaseReport score={voiceScore} onDone={() => router.push("/dashboard")} />
      ) : (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 18,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: "var(--neutral-tint)",
                color: "var(--ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              ◆
            </div>
            <h1
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: 24,
                letterSpacing: 0,
                margin: 0,
                color: "var(--ink)",
              }}
            >
              Case Coach
            </h1>
            <span style={{ fontSize: 13, color: "var(--ink-3)", marginLeft: "auto" }}>
              Live voice case interview
            </span>
          </div>

          <CaseVoiceInterview onComplete={completeVoiceInterview} />
        </div>
      )}
    </div>
  );
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
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0, lineHeight: 1.35 }}>{score.next_focus[0]}</div>
          </div>
          <button onClick={onDone} style={{ flex: "none", border: "none", background: "#fff", color: "#0b1020", fontSize: 14, fontWeight: 600, padding: "12px 20px", borderRadius: 8, cursor: "pointer" }}>
            Back to dashboard →
          </button>
        </div>
      )}
    </div>
  );
}
