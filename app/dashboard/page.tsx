"use client";

import Link from "next/link";
import { useReadiness, type ModuleResult, type ModuleStatus } from "@/components/readiness-store";
import { ReadinessRing } from "@/components/ui/ReadinessRing";
import { ModuleCard } from "@/components/ui/ModuleCard";
import { NextBestAction } from "@/components/ui/NextBestAction";
import { MeterBar, GroundingNote } from "@/components/ui/primitives";
import { readinessBand } from "@/components/ui/verdict";
import { isProvisionalCaseResult } from "@/components/ui/dashboardPresentation";

function badgeFor(status: ModuleStatus): { text: string; color: string; tint: string } {
  switch (status) {
    case "done":
      return { text: "Complete", color: "var(--success)", tint: "var(--success-tint)" };
    case "in_progress":
      return { text: "In progress", color: "var(--partial)", tint: "var(--partial-tint)" };
    default:
      return { text: "Not started", color: "var(--ink-3)", tint: "var(--neutral-tint)" };
  }
}

function statusLine(m: ModuleResult, fallback: string): string {
  return m.statusLine ?? fallback;
}

export default function Dashboard() {
  const { state, overallReadiness, nextBestAction } = useReadiness();
  const overall = overallReadiness();
  const band = overall != null ? readinessBand(overall) : null;
  const action = nextBestAction();
  const caseIsProvisional = isProvisionalCaseResult(state.case);
  const caseBadge = caseIsProvisional
    ? {
        text: "Provisional",
        color: "var(--partial)",
        tint: "var(--partial-tint)",
      }
    : badgeFor(state.case.status);

  const role = state.target.role ?? "No role set yet";
  const company = state.target.company;

  const modulesDone = [state.fit, state.behavioural, state.case].filter((m) => m.status === "done").length;

  return (
    <main className="page-shell dashboard-shell page-enter">
      {/* header */}
      <div className="dashboard-header" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 32, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ink-4)", marginBottom: 10 }}>
            Readiness for
          </div>
          {state.targetSource === "sample" && (
            <div className="dashboard-sample-badge">
              Sample readiness plan
            </div>
          )}
          <h1 className="page-title dashboard-role-title">
            {role}
          </h1>
          <p className="dashboard-role-description">
            {company && <><strong>{company}</strong><span aria-hidden="true"> · </span></>}
            See how your resume evidence, interview stories, and case performance line up with this target—and what to
            strengthen next.
          </p>
        </div>
        <Link
          href="/onboard"
          className="app-button app-button--secondary"
          style={{ minHeight: 38, padding: "8px 14px" }}
        >
          {state.targetSource === "sample" ? "Use my own role" : "Change role"}
        </Link>
      </div>

      <div className="bento-grid">
        {/* readiness card */}
        <div
          className="col-6 dashboard-readiness-card"
          style={{
            minWidth: 0,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 2,
            padding: 36,
            boxShadow: "var(--shadow-sm)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div className="dashboard-readiness-card__geometry" aria-hidden="true" />
          <div style={{ position: "relative", display: "flex", gap: 38, alignItems: "center", flexWrap: "wrap" }}>
            <div className="dashboard-overall-score" aria-label={overall === null ? "Overall readiness pending" : `Overall readiness ${overall} out of 100`}>
              <ReadinessRing value={overall} size={132} strokeWidth={10} color={band?.color ?? "var(--accent)"} suffix="of 100" />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-4)", marginBottom: 8 }}>
                Overall Readiness
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "5px 11px",
                  borderRadius: 999,
                  background: band?.tintBg ?? "var(--neutral-tint)",
                  marginBottom: 20,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: band?.color ?? "var(--ink-3)" }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: band?.color ?? "var(--ink-3)" }}>
                  {band?.label ?? "Not started"}
                </span>
              </div>
              <div className="dashboard-readiness-breakdown" aria-label="Readiness score breakdown">
                <BreakdownRow label="Fit Analyzer" module={state.fit} color="var(--accent)" />
                <BreakdownRow label="Behavioural" module={state.behavioural} color="var(--secondary)" />
                <BreakdownRow
                  label="Case / Strategy"
                  module={state.case}
                  color="var(--ink)"
                  provisional={caseIsProvisional}
                />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 18 }}>
                {modulesDone} of 3 modules complete
              </div>
            </div>
          </div>
        </div>

        {/* next best action */}
        <div className="col-6" style={{ minWidth: 0 }}>
          <NextBestAction title={action.title} desc={action.desc} cta={action.cta} href={action.href} />
        </div>

        {/* module cards */}
        <ModuleCard
          className="col-4 module-card--inverse"
          href="/fit"
          glyph="◎"
          iconColor="var(--accent-ink)"
          iconTint="var(--accent-tint)"
          title="Resume Fit"
          statusLine={statusLine(state.fit, "Diagnose your match to the role")}
          badge={badgeFor(state.fit.status)}
          score={state.fit.score}
          ctaLabel="Analyze fit"
          hoverBorder="var(--accent)"
        />
        <ModuleCard
          className="col-4 module-card--signal"
          href="/behavioural"
          glyph="◈"
          iconColor="var(--secondary)"
          iconTint="var(--secondary-tint)"
          title="Behavioural"
          statusLine={statusLine(state.behavioural, "Rehearse and get coached")}
          badge={badgeFor(state.behavioural.status)}
          score={state.behavioural.score}
          ctaLabel="Rehearse"
          hoverBorder="var(--secondary)"
        />
        <ModuleCard
          className="col-4"
          href="/case"
          glyph="◆"
          iconColor="var(--ink)"
          iconTint="var(--neutral-tint)"
          title="The GRID"
          statusLine={statusLine(state.case, "Enter Case Simulation")}
          badge={caseBadge}
          score={state.case.score}
          scoreLabel={caseIsProvisional ? "Provisional Case / Strategy score" : "Case / Strategy readiness"}
          ctaLabel="Open The GRID"
          hoverBorder="var(--ink-3)"
        />

        {/* grounding strip */}
        <div className="col-12">
          <GroundingNote>
            Requirements and scoring are grounded in verified occupational data for this role — a quiet check that keeps
            your readiness honest.
          </GroundingNote>
        </div>
      </div>
    </main>
  );
}

function BreakdownRow({
  label,
  module,
  color,
  provisional = false,
}: {
  label: string;
  module: ModuleResult;
  color: string;
  provisional?: boolean;
}) {
  const has = module.score != null;
  const valueLabel = has
    ? `${module.score} out of 100${provisional ? ", provisional" : ""}`
    : "Pending";
  return (
    <div
      className={`dashboard-breakdown-row${provisional ? " is-provisional" : ""}${has ? "" : " is-pending"}`}
      aria-label={`${label}: ${valueLabel}`}
    >
      <span className="dashboard-breakdown-row__label">{label}</span>
      <MeterBar value={has ? (module.score as number) : 0} color={color} height={6} muted={!has} />
      <span className="dashboard-breakdown-row__value">
        {has ? module.score : "Pending"}
      </span>
      {provisional && <span className="dashboard-breakdown-row__status">Provisional</span>}
    </div>
  );
}
