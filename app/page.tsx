"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { ModuleCarousel } from "@/components/ui/ModuleCarousel";
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
    variant: "inverse" as const,
  },
  {
    glyph: "◈",
    color: "var(--secondary)",
    tint: "var(--secondary-tint)",
    title: "Behavioural",
    blurb:
      "Answer real questions with a STAR scaffold, then get scored coaching and a stronger version of every answer.",
    variant: "signal" as const,
  },
  {
    glyph: "◆",
    color: "var(--ink)",
    tint: "var(--neutral-tint)",
    title: "The GRID",
    blurb:
      "Enter a live Case Simulation now, with role-specific Technical Simulation previews ready for what comes next.",
  },
];

const READINESS_DETAILS = [
  {
    number: "01",
    title: "Know the role",
    body: "Turn the job description into a clear picture of the capabilities, evidence, and interview signals the role actually demands.",
  },
  {
    number: "02",
    title: "Know your proof",
    body: "See which claims your resume and prepared stories already support—and where an interviewer will expect stronger evidence.",
  },
  {
    number: "03",
    title: "Know what to practice",
    body: "Use one readiness view to focus on the next answer, skill gap, or case habit most likely to improve your performance.",
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

      {/* header */}
      <header className="landing-header">
        <Link href="/" aria-label="Go to the Synthesis landing page" style={{ textDecoration: "none" }}>
          <Logo size={27} />
        </Link>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 8.5,
            fontWeight: 500,
            letterSpacing: ".16em",
            color: "var(--ink-3)",
            marginLeft: 8,
          }}
        >
          LAB / 001
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={toggle}
          className="nav-theme-toggle"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            cursor: "pointer",
            color: "var(--ink-2)",
          }}
        >
          {theme === "dark" ? "☼" : "☾"}
        </button>
        <button
          onClick={goSample}
          className="app-button app-button--quiet landing-sample-link"
        >
          See a sample
        </button>
        <Link
          href="/onboard"
          className="app-button app-button--primary"
          style={{ minHeight: 38, padding: "8px 15px" }}
        >
          Get started
        </Link>
      </header>

      {/* hero */}
      <main className="landing-hero hero-grid">
        <div style={{ animation: "fadeUp .55s ease both" }}>
          <div className="editorial-kicker">Interview readiness / 01</div>
          <h1 className="hero-title">
            <span className="hero-title__line">Know where</span>
            <span className="hero-title__line">you stand.</span>
            <span className="hero-title__line hero-title__line--signal">Walk in ready.</span>
          </h1>
          <p style={{ maxWidth: 560, fontSize: 18, lineHeight: 1.58, color: "var(--ink-2)", margin: "0 0 34px" }}>
            Diagnose your resume fit, coach your behavioural answers, and drill live case interviews — rolled into
            one readiness score that tells you exactly what to improve next.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Link
              href="/onboard"
              className="app-button app-button--primary"
              style={{ minHeight: 50, padding: "14px 22px" }}
            >
              Start with your role →
            </Link>
            <button
              onClick={goSample}
              className="app-button app-button--secondary"
              style={{ minHeight: 50, padding: "14px 20px" }}
            >
              See a sample run
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 28, fontSize: 12.5, color: "var(--ink-3)", flexWrap: "wrap" }}>
            <span>No account needed</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--ink-4)" }} />
            <span>~5 minutes</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--ink-4)" }} />
            <span>Grounded in real role data</span>
          </div>
        </div>

        {/* bento preview */}
        <div className="hero-stage" style={{ animation: "fadeUp .65s .08s ease both" }}>
          <div className="hero-stage__plan">Readiness plan / live</div>
          <div className="hero-stage__mass" aria-hidden="true" />
          <button
            type="button"
            onClick={goSample}
            aria-label="See a sample readiness dashboard"
            className="hero-preview-shell"
            style={{
              display: "block",
              textAlign: "left",
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <HeroPreview />
          </button>
        </div>
      </main>

      <section className="landing-role-section">
        <div className="landing-role-intro">
          <div className="editorial-kicker">Role clarity / 02</div>
          <h2>Know the role before you rehearse the interview.</h2>
          <p>
            Synthesis connects the job you want to the evidence you already have, then turns the distance between them
            into a focused preparation plan.
          </p>
        </div>
        <div className="landing-role-details">
          {READINESS_DETAILS.map((detail) => (
            <article key={detail.number} className="landing-role-detail">
              <span>{detail.number}</span>
              <h3>{detail.title}</h3>
              <p>{detail.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* explainer */}
      <section className="landing-section">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 30, flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontFamily: "var(--font-sans)", fontWeight: 720, fontSize: "clamp(30px,4vw,50px)", letterSpacing: "-.055em", margin: 0, color: "var(--ink)" }}>
            Three modules, one score
          </h2>
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>Each returns a verdict, a score, and a clear next step.</span>
        </div>
        <ModuleCarousel items={MODULES} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 28, flexWrap: "wrap" }}>
          <Link
            href="/onboard"
            className="app-button app-button--primary"
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
      </section>
    </div>
  );
}

/** Static "dashboard preview" bento shown in the hero. */
function HeroPreview() {
  const bars = [
    { label: "Fit", pct: 72, color: "var(--preview-accent)", val: 72 },
    { label: "Behavioural", pct: 79, color: "var(--secondary)", val: 79 },
    { label: "Case readiness", pct: 85, color: "var(--inverse-ink)", val: 85 },
  ];
  const cards = [
    { glyph: "◎", color: "var(--accent-ink)", tint: "var(--accent-tint)", title: "Resume Fit", sub: "3 matched · 2 gaps", score: 72 },
    { glyph: "◈", color: "var(--secondary)", tint: "var(--secondary-tint)", title: "Behavioural", sub: "5 answers coached", score: 79 },
    { glyph: "◆", color: "var(--inverse-ink)", tint: "var(--preview-line)", title: "The GRID", sub: "Case Simulation readiness", score: 85 },
  ];
  return (
    <div className="hero-preview">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--preview-line)", background: "var(--preview-surface)" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--preview-muted)" }} />
          ))}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: ".08em", color: "var(--preview-muted)", marginLeft: 6 }}>SYNTHESIS / DASHBOARD</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--success)", background: "var(--success-tint)", padding: "3px 9px", borderRadius: 999 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--success)" }} />
          Interview-ready
        </div>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, background: "var(--inverse)" }}>
        <div className="hero-preview-top">
          <div style={{ background: "var(--preview-surface)", border: "1px solid var(--preview-line)", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ position: "relative", width: 88, height: 88, flex: "none" }}>
              <svg viewBox="0 0 120 120" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--preview-line)" strokeWidth="12" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--preview-accent)" strokeWidth="12" strokeLinecap="round" strokeDasharray="327" strokeDashoffset="88" />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 740, letterSpacing: "-.05em", fontVariantNumeric: "tabular-nums", lineHeight: 1, color: "var(--inverse-ink)" }}>73</div>
                <div style={{ fontSize: 9, color: "var(--preview-muted)" }}>of 100</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--preview-muted)", marginBottom: 9 }}>
                Overall readiness
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {bars.map((b) => (
                  <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10.5, color: "var(--preview-muted)", width: 86, flex: "none" }}>{b.label}</span>
                    <div style={{ flex: 1, height: 4, background: "var(--preview-line)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${b.pct}%`, height: "100%", background: b.color, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: "var(--inverse-ink)" }}>{b.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ background: "var(--codex-gray)", borderRadius: 14, padding: 16, color: "var(--codex-gray-contrast)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", right: -24, top: -24, width: 110, height: 110, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,255,255,.12),transparent 70%)" }} />
            <div style={{ position: "relative" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "color-mix(in srgb,var(--codex-gray-contrast) 62%,transparent)", marginBottom: 8 }}>
                Next best action
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 10 }}>Rehearse two answers on impact</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 650, background: "color-mix(in srgb,var(--codex-gray-contrast) 14%,transparent)", padding: "5px 11px", borderRadius: 6 }}>
                Rehearse →
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {cards.map((c) => (
            <div key={c.title} style={{ background: "var(--preview-surface)", border: "1px solid var(--preview-line)", borderRadius: 12, padding: 13 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: c.tint, color: c.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{c.glyph}</div>
                <span style={{ fontSize: 19, fontWeight: 720, fontVariantNumeric: "tabular-nums", color: "var(--inverse-ink)" }}>{c.score}</span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "-.01em", color: "var(--inverse-ink)" }}>{c.title}</div>
              <div style={{ fontSize: 10.5, color: "var(--preview-muted)", marginTop: 2 }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
