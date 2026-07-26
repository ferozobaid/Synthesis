"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReadiness } from "@/components/readiness-store";

export function ReadinessOverviewSlide() {
  const router = useRouter();
  const { seedSample } = useReadiness();

  function goSample() {
    seedSample();
    router.push("/dashboard");
  }

  return (
    <div className="home-slide home-slide--readiness">
      <ReadinessStage
        className="home-readiness-stage--mobile"
        onOpenSample={goSample}
      />

      <div className="home-slide__copy">
        <div className="editorial-kicker">Interview readiness / 01</div>
        <h1 data-slide-heading tabIndex={-1} className="home-slide__headline">
          <span>Know where</span>
          <span>you stand.</span>
          <span className="home-slide__headline-muted">Walk in ready.</span>
        </h1>
        <p className="home-slide__description">
          Diagnose your resume fit, coach your behavioural answers, and drill live case interviews — rolled into one
          readiness score that tells you exactly what to improve next.
        </p>
        <div className="home-slide__actions">
          <Link href="/onboard" className="app-button app-button--primary">
            Start with your role →
          </Link>
          <button type="button" onClick={goSample} className="app-button app-button--secondary">
            See a sample run
          </button>
        </div>
        <div className="home-slide__metadata">
          <span>No account needed</span><i aria-hidden="true" />
          <span>~5 minutes</span><i aria-hidden="true" />
          <span>Grounded in real role data</span>
        </div>
      </div>

      <ReadinessStage
        className="home-readiness-stage--desktop"
        onOpenSample={goSample}
      />
    </div>
  );
}

function ReadinessStage({
  className,
  onOpenSample,
}: {
  className: string;
  onOpenSample: () => void;
}) {
  return (
    <div className={`home-readiness-stage ${className}`}>
      <span className="home-readiness-stage__label">Readiness plan / live</span>
      <button
        type="button"
        onClick={onOpenSample}
        className="home-readiness-preview-button"
        aria-label="See a sample readiness dashboard"
      >
        <ReadinessPreview />
      </button>
    </div>
  );
}

function ReadinessPreview() {
  const bars = [
    { label: "Fit", value: 72, color: "var(--preview-accent)" },
    { label: "Behavioural", value: 79, color: "var(--secondary)" },
    { label: "Case readiness", value: 85, color: "var(--inverse-ink)" },
  ];
  const cards = [
    { glyph: "◎", title: "Resume Fit", sub: "3 matched · 2 gaps", score: 72 },
    { glyph: "◈", title: "Behavioural", sub: "5 answers coached", score: 79 },
    { glyph: "◆", title: "The GRID", sub: "Case Simulation readiness", score: 85 },
  ];

  return (
    <div className="home-readiness-preview">
      <div className="home-readiness-preview__chrome">
        <span /><span /><span />
        <b>SYNTHESIS / DASHBOARD</b>
        <em>Interview-ready</em>
      </div>
      <div className="home-readiness-preview__body">
        <div className="home-readiness-preview__top">
          <div className="home-readiness-preview__score">
            <div className="home-readiness-preview__ring">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="52" />
                <circle cx="60" cy="60" r="52" className="is-value" />
              </svg>
              <strong>73<small>of 100</small></strong>
            </div>
            <div className="home-readiness-preview__breakdown">
              <label>Overall readiness</label>
              {bars.map((bar) => (
                <div key={bar.label}>
                  <span>{bar.label}</span>
                  <i><b style={{ width: `${bar.value}%`, background: bar.color }} /></i>
                  <strong>{bar.value}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="home-readiness-preview__next">
            <label>Next best action</label>
            <strong>Rehearse two answers on impact</strong>
            <span>Rehearse →</span>
          </div>
        </div>
        <div className="home-readiness-preview__cards">
          {cards.map((card) => (
            <article key={card.title}>
              <div><i>{card.glyph}</i><strong>{card.score}</strong></div>
              <b>{card.title}</b>
              <span>{card.sub}</span>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
