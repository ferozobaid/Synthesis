"use client";

import Link from "next/link";
import { useReadiness, type ModuleResult, type ModuleStatus } from "@/components/readiness-store";
import { ReadinessRing } from "@/components/ui/ReadinessRing";
import { ModuleCard } from "@/components/ui/ModuleCard";
import { NextBestAction } from "@/components/ui/NextBestAction";
import { MeterBar, GroundingNote } from "@/components/ui/primitives";
import { readinessBand } from "@/components/ui/verdict";

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

  const role = state.target.role ?? "No role set yet";
  const company = state.target.company;

  const modulesDone = [state.fit, state.behavioural, state.case].filter((m) => m.status === "done").length;

  return (
    <main className="page-shell dashboard-shell" style={{ animation: "fadeIn .4s ease both" }}>
      {/* header */}
      <div className="dashboard-header" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 32, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ink-4)", marginBottom: 10 }}>
            Readiness for
          </div>
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
          Change role
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
            <ReadinessRing value={overall} size={132} strokeWidth={10} color={band?.color ?? "var(--accent)"} suffix="of 100" />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-4)", marginBottom: 8 }}>
                Overall readiness
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
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <BreakdownRow label="Resume fit" module={state.fit} color="var(--accent)" />
                <BreakdownRow label="Behavioural" module={state.behavioural} color="var(--secondary)" />
                <BreakdownRow label="Case" module={state.case} color="var(--ink)" />
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
          title="Case Interview"
          statusLine={statusLine(state.case, "Drill an adaptive case")}
          badge={badgeFor(state.case.status)}
          score={state.case.score}
          ctaLabel="Drill a case"
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

function BreakdownRow({ label, module, color }: { label: string; module: ModuleResult; color: string }) {
  const has = module.score != null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 12, color: "var(--ink-3)", width: 92, flex: "none" }}>{label}</span>
      <MeterBar value={has ? (module.score as number) : 0} color={color} height={6} muted={!has} />
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)", width: 22, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {has ? module.score : "—"}
      </span>
    </div>
  );
}
