import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  interviewReadinessSourceCopy,
} from "@/components/ui/dashboardPresentation";
import {
  shouldOpenDashboardSpotlight,
} from "@/components/hero/navigationState";

const dashboard = readFileSync("app/dashboard/page.tsx", "utf8");
const spotlight = readFileSync(
  "components/ui/DashboardAchievementSpotlight.tsx",
  "utf8",
);
const navigation = readFileSync("components/hero/HeroNav.tsx", "utf8");
const chrome = readFileSync("components/ui/SiteChrome.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

describe("Dashboard Achievement Spotlight navigation", () => {
  it("intercepts Dashboard only on the exact dashboard route", () => {
    expect(shouldOpenDashboardSpotlight("/dashboard")).toBe(true);
    expect(shouldOpenDashboardSpotlight("/fit")).toBe(false);
    expect(shouldOpenDashboardSpotlight("/behavioural")).toBe(false);
    expect(shouldOpenDashboardSpotlight("/case")).toBe(false);
    expect(navigation).toContain('href="/dashboard"');
    expect(navigation).toContain("event.preventDefault()");
    expect(navigation).toContain("onDashboardSpotlight?.(event.currentTarget)");
  });

  it("uses one narrowly scoped React context without routing or reloading", () => {
    expect(chrome).toContain("<DashboardSpotlightContext.Provider");
    expect(chrome).toContain("onDashboardSpotlight={toggleSpotlight}");
    expect(chrome).toContain("setSpotlightOpen((open) =>");
    expect(dashboard).toContain("useDashboardSpotlight()");
    expect(navigation).toContain('aria-haspopup=');
    expect(navigation).toContain('dashboardSpotlightOpen');
    expect(spotlight).not.toContain("useRouter");
    expect(spotlight).not.toContain("fetch(");
  });

  it("opens the same Spotlight from the Overall Readiness card", () => {
    expect(dashboard).toContain('aria-label="Open achievement spotlight"');
    expect(dashboard).toContain('aria-haspopup="dialog"');
    expect(dashboard).toContain("activateSpotlight(event.currentTarget)");
    expect(chrome).toContain("activate: toggleSpotlight");
    expect(styles).toContain(".dashboard-readiness-card:focus-visible");
  });

  it("leaves every unrelated navigation destination unchanged", () => {
    expect(navigation).toContain(
      '{ label: "Fit", mobileLabel: "Fit Analyzer", href: "/fit" }',
    );
    expect(navigation).toContain(
      '{ label: "Behavioural", mobileLabel: "Behavioural Interview", href: "/behavioural" }',
    );
    expect(navigation).toContain(
      '{ label: "GRID", mobileLabel: "The GRID", href: "/case" }',
    );
    expect(navigation).toContain('href="/onboard"');
  });
});

describe("Dashboard Achievement Spotlight presentation", () => {
  it("renders existing readiness values and never introduces a formula", () => {
    expect(dashboard).toContain("const overall = overallReadiness();");
    expect(dashboard).toContain("overall={overall}");
    expect(dashboard).toContain("fit={state.fit}");
    expect(dashboard).toContain("behavioural={state.behavioural}");
    expect(dashboard).toContain("interview={state.case}");
    expect(dashboard).toContain("interviewSource={state.interviewSource}");
    expect(spotlight).toContain("Overall Readiness");
    expect(spotlight).toContain("Fit Analyzer");
    expect(spotlight).toContain("Behavioural");
    expect(spotlight).toContain("Interview Readiness");
    expect(spotlight).not.toContain("overallReadiness");
    expect(spotlight).not.toMatch(/reduce\(|average|\/\s*3/);
  });

  it("maps every stored interview source to candid supporting copy", () => {
    const source = {
      caseId: "case",
      provisional: false,
      completedAt: 1,
    };
    expect(
      interviewReadinessSourceCopy({ ...source, kind: "strategy" }),
    ).toBe("Based on your latest Strategy case");
    expect(
      interviewReadinessSourceCopy({
        ...source,
        kind: "data_analyst_technical",
      }),
    ).toBe("Based on your latest Data Analyst technical interview");
    expect(
      interviewReadinessSourceCopy({
        ...source,
        kind: "data_engineer_technical",
      }),
    ).toBe("Based on your latest Data Engineer technical interview");
    expect(
      interviewReadinessSourceCopy({
        ...source,
        kind: "clickstream_system_design",
      }),
    ).toBe("Based on your latest Clickstream system-design interview");
    expect(interviewReadinessSourceCopy(null)).toBe(
      "Interview source pending",
    );
  });

  it("keeps Pending, Provisional, and Complete states explicit", () => {
    expect(spotlight).toContain(
      'interview.score == null ? "Pending" : provisional ? "Provisional" : "Complete"',
    );
    expect(spotlight).toContain("interviewSource?.provisional");
    expect(spotlight).toContain("isProvisionalCaseResult(interview)");
    expect(spotlight).toContain('className="dashboard-spotlight__state"');
  });

  it("keeps the normal dashboard mounted beneath the closed layer", () => {
    expect(dashboard).toContain('<div className="bento-grid">');
    expect(dashboard).toContain("open={spotlightOpen}");
    expect(spotlight).toContain('data-open={open ? "true" : "false"}');
    expect(styles).toContain(
      '.dashboard-spotlight[data-open="true"]',
    );
  });
});

describe("Dashboard Achievement Spotlight accessibility and responsive contracts", () => {
  it("supports Escape, backdrop, panel containment, and visible close controls", () => {
    expect(spotlight).toContain('event.key === "Escape"');
    expect(spotlight).toContain(
      "if (event.target === event.currentTarget) onClose();",
    );
    expect(spotlight).toContain(
      "onMouseDown={(event) => event.stopPropagation()}",
    );
    expect(spotlight).toContain('aria-label="Close achievement spotlight"');
    expect(spotlight).toContain("Return to dashboard");
  });

  it("moves, contains, and restores focus while controlling document scroll", () => {
    expect(spotlight).toContain("closeRef.current?.focus()");
    expect(spotlight).toContain('event.key !== "Tab"');
    expect(spotlight).toContain('document.body.style.overflow = "hidden"');
    expect(chrome).toContain("spotlightTriggerRef.current?.focus()");
    expect(spotlight).toContain('role="dialog"');
    expect(spotlight).toContain('aria-modal="true"');
    expect(spotlight).toContain(
      'aria-labelledby="dashboard-spotlight-title"',
    );
  });

  it("defines desktop, tablet, phone, and reduced-motion treatments", () => {
    expect(styles).toContain(
      "width: min(920px, calc(100vw - 40px));",
    );
    expect(styles).toContain("@media (max-width: 768px)");
    expect(styles).toContain("@media (max-width: 480px)");
    expect(styles).toContain("height: 100dvh;");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(
      /\.dashboard-spotlight__panel,[\s\S]*transform: none !important;/,
    );
    expect(styles).toContain("overflow-y: auto;");
    expect(styles).toContain(
      '.product-experience:has(.dashboard-spotlight[data-open="true"])',
    );
  });
});
