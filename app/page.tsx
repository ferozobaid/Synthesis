"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { useReadiness } from "@/components/readiness-store";
import { useTheme } from "@/components/theme";

const MODULES = [
  {
    glyph: "◎",
    color: "var(--accent-ink)",
    tint: "var(--accent-tint)",
    title: "Resume Fit",
    blurb:
      "See where you match, partially match, and fall short of the role — each backed by a line of evidence from your resume.",
  },
  {
    glyph: "◈",
    color: "var(--secondary)",
    tint: "var(--secondary-tint)",
    title: "Behavioural",
    blurb:
      "Answer real questions with a STAR scaffold, then get scored coaching and a stronger version of every answer.",
  },
  {
    glyph: "◆",
    color: "var(--ink)",
    tint: "var(--neutral-tint)",
    title: "Case Interview",
    blurb:
      "Work an adaptive case end to end — exhibits, pressure tests, and a scored performance report at the finish.",
  },
];

export default function Landing() {
  const router = useRouter();
  const { seedSample } = useReadiness();
  const { theme, toggle } = useTheme();

  function goSample() {
    seedSample();
    router.push("/dashboard");
  }

  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(90% 60% at 78% -6%,var(--accent-tint-2),transparent 55%),radial-gradient(70% 50% at 8% 4%,var(--secondary-tint),transparent 46%)",
          opacity: 0.7,
          pointerEvents: "none",
        }}
      />

      {/* header */}
      <div
        style={{
          position: "relative",
          maxWidth: 1200,
          margin: "0 auto",
          padding: "22px 32px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          rowGap: 12,
        }}
      >
        <Logo size={27} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: ".04em",
            color: "var(--ink-3)",
            border: "1px solid var(--line)",
            background: "var(--surface)",
            padding: "3px 8px",
            borderRadius: 6,
            marginLeft: 4,
          }}
        >
          BETA
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={toggle}
          title="Switch theme"
          aria-label="Switch theme"
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            cursor: "pointer",
            color: "var(--ink-2)",
          }}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
        <button
          onClick={goSample}
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--ink-2)",
            cursor: "pointer",
            padding: "8px 12px",
            borderRadius: 9,
            border: "none",
            background: "transparent",
          }}
        >
          See a sample
        </button>
        <Link
          href="/onboard"
          style={{
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13.5,
            fontWeight: 600,
            padding: "9px 16px",
            borderRadius: 9,
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          Get started
        </Link>
      </div>

      {/* hero */}
      <div
        style={{
          position: "relative",
          maxWidth: 1200,
          margin: "0 auto",
          padding: "40px 32px 30px",
        }}
        className="hero-grid"
      >
        <div style={{ animation: "fadeUp .55s ease both" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 12px",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--ink-2)",
              boxShadow: "var(--shadow-sm)",
              marginBottom: 22,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--secondary)" }} />
            AI interview-readiness platform
          </div>
          <h1
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 700,
              fontSize: 44,
              lineHeight: 1.06,
              letterSpacing: "-.03em",
              margin: "0 0 18px",
              color: "var(--ink)",
            }}
          >
            Know where you stand. Walk in{" "}
            <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 500, color: "var(--accent)" }}>
              ready
            </span>
            .
          </h1>
          <p style={{ fontSize: 16.5, lineHeight: 1.6, color: "var(--ink-2)", margin: "0 0 28px" }}>
            Diagnose your resume fit, coach your behavioural answers, and drill live case interviews — rolled into
            one readiness score that tells you exactly what to improve next.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Link
              href="/onboard"
              style={{
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
                padding: "14px 24px",
                borderRadius: 12,
                cursor: "pointer",
                boxShadow: "0 8px 22px rgba(91,87,232,.30)",
                textDecoration: "none",
              }}
            >
              Start with your role →
            </Link>
            <button
              onClick={goSample}
              style={{
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--ink)",
                fontSize: 15,
                fontWeight: 600,
                padding: "14px 20px",
                borderRadius: 12,
                cursor: "pointer",
              }}
            >
              See a sample run
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 26, fontSize: 12.5, color: "var(--ink-3)", flexWrap: "wrap" }}>
            <span>No account needed</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--ink-4)" }} />
            <span>~5 minutes</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--ink-4)" }} />
            <span>Grounded in real role data</span>
          </div>
        </div>

        {/* bento preview */}
        <button
          type="button"
          onClick={goSample}
          aria-label="See a sample readiness dashboard"
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            border: "none",
            background: "transparent",
            padding: 0,
            animation: "fadeUp .65s .08s ease both",
            cursor: "pointer",
          }}
        >
          <HeroPreview />
        </button>
      </div>

      {/* explainer */}
      <div style={{ position: "relative", maxWidth: 1200, margin: "0 auto", padding: "44px 32px 80px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 24, letterSpacing: "-.025em", margin: 0, color: "var(--ink)" }}>
            Three modules, one score
          </h2>
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>Each returns a verdict, a score, and a clear next step.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {MODULES.map((m) => (
            <div
              key={m.title}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 16,
                padding: 22,
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: m.tint,
                  color: m.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  marginBottom: 14,
                }}
              >
                {m.glyph}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-.01em", color: "var(--ink)" }}>
                {m.title}
              </h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-2)", margin: 0 }}>{m.blurb}</p>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 28, flexWrap: "wrap" }}>
          <Link
            href="/onboard"
            style={{
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              padding: "14px 24px",
              borderRadius: 12,
              cursor: "pointer",
              boxShadow: "0 8px 22px rgba(91,87,232,.28)",
              textDecoration: "none",
            }}
          >
            Start with your role →
          </Link>
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
            or{" "}
            <button
              type="button"
              onClick={goSample}
              style={{ color: "var(--accent-ink)", fontWeight: 600, cursor: "pointer", background: "none", border: "none", padding: 0, font: "inherit" }}
            >
              explore a sample candidate
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Static "dashboard preview" bento shown in the hero. */
function HeroPreview() {
  const bars = [
    { label: "Fit", pct: 72, color: "var(--accent)", val: 72 },
    { label: "Behavioural", pct: 79, color: "var(--secondary)", val: 79 },
    { label: "Case", pct: 85, color: "var(--ink)", val: 85 },
  ];
  const cards = [
    { glyph: "◎", color: "var(--accent-ink)", tint: "var(--accent-tint)", title: "Resume Fit", sub: "3 matched · 2 gaps", score: 72 },
    { glyph: "◈", color: "var(--secondary)", tint: "var(--secondary-tint)", title: "Behavioural", sub: "5 answers coached", score: 79 },
    { glyph: "◆", color: "var(--ink)", tint: "var(--neutral-tint)", title: "Case", sub: "1 case · full report", score: 85 },
  ];
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "var(--shadow-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--ink-4)" }} />
          ))}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-4)", marginLeft: 6 }}>synthesis · dashboard</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--success)", background: "var(--success-tint)", padding: "3px 9px", borderRadius: 999 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--success)" }} />
          Interview-ready
        </div>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="hero-preview-top">
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ position: "relative", width: 88, height: 88, flex: "none" }}>
              <svg viewBox="0 0 120 120" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" strokeWidth="12" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" strokeWidth="12" strokeLinecap="round" strokeDasharray="327" strokeDashoffset="88" />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1, color: "var(--ink)" }}>73</div>
                <div style={{ fontSize: 9, color: "var(--ink-4)" }}>of 100</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-4)", marginBottom: 9 }}>
                Overall readiness
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {bars.map((b) => (
                  <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--ink-3)", width: 64 }}>{b.label}</span>
                    <div style={{ flex: 1, height: 4, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${b.pct}%`, height: "100%", background: b.color, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{b.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ background: "var(--glow)", borderRadius: 14, padding: 16, color: "#fff", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", right: -24, top: -24, width: 110, height: 110, borderRadius: "50%", background: "radial-gradient(circle,rgba(91,87,232,.4),transparent 70%)" }} />
            <div style={{ position: "relative" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.55)", marginBottom: 8 }}>
                Next best action
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 10 }}>Rehearse two answers on impact</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, background: "rgba(255,255,255,.12)", padding: "5px 11px", borderRadius: 8 }}>
                Rehearse →
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {cards.map((c) => (
            <div key={c.title} style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 13 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: c.tint, color: c.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{c.glyph}</div>
                <span style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{c.score}</span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-.01em", color: "var(--ink)" }}>{c.title}</div>
              <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
