import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isProvisionalCaseResult } from "@/components/ui/dashboardPresentation";
import {
  DEFAULT_READINESS_STATE,
  hydrateReadinessState,
} from "@/components/readiness-store";

const dashboard = readFileSync("app/dashboard/page.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");
const caseVoice = readFileSync("components/CaseVoiceInterview.tsx", "utf8");
const nativeReport = readFileSync(
  "components/CaseNativeVoiceInterview.tsx",
  "utf8",
);

describe("session visual polish contracts", () => {
  it("keeps the behavioural radio selector semantic and visibly recommended", () => {
    expect(caseVoice).toContain('aria-label={`Difficulty ${entry.difficultyStars} of 5`}');
    expect(styles).toContain(".behavioural-preflight__modes label:focus-within");
    expect(styles).toContain(
      '.behavioural-preflight__modes label:has(input[value="focused"])::after',
    );
    expect(styles).toContain('content: "Recommended";');
    expect(styles).toContain("@media (max-width: 700px)");
  });

  it("presents catalog metadata and outcomes without replacing their contracts", () => {
    expect(caseVoice).toContain("caseDifficultyLabel(entry.difficultyStars)");
    expect(caseVoice).toContain("caseDurationLabel(entry.maxDurationSeconds)");
    expect(caseVoice).toContain("caseOutcomeSummary(outcomes[entry.id])");
    expect(styles).toContain(".case-picker-card__meta > span:last-child::before");
    expect(styles).toContain('content: "MAX";');
    expect(styles).toContain(
      '.case-picker-card__outcome[style*="var(--partial)"]',
    );
  });

  it("keeps the server timer understandable and reduced-motion safe", () => {
    expect(caseVoice).toContain('aria-label="Case interview time remaining"');
    expect(caseVoice).toContain('aria-live={timerWarning !== null ? "polite" : "off"}');
    expect(caseVoice).toContain('case-voice-timer${timerWarning !== null ? " is-warning" : ""}');
    expect(styles).toContain(".case-voice-timer.is-warning");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("visually distinguishes a scored partial report without hiding caveats", () => {
    expect(nativeReport).toContain("Provisional score — this interview ended before every stage was");
    expect(nativeReport).toContain("presentation.missingStages");
    expect(styles).toContain(
      '.case-native-report:has(> div:first-child > div[style*="var(--partial)"])',
    );
    expect(styles).toContain(
      '.case-native-report > section:first-of-type p[style*="var(--partial)"]',
    );
  });
});

describe("dashboard Interview Readiness presentation", () => {
  it("renders all three modules and passes the existing overall contract through", () => {
    expect(dashboard).toContain("const overall = overallReadiness();");
    expect(dashboard).toContain("<ReadinessRing value={overall}");
    expect(dashboard).toContain('label="Fit Analyzer"');
    expect(dashboard).toContain('label="Behavioural"');
    expect(dashboard).toContain('label="Interview"');
    expect(dashboard).toContain("module={state.case}");
    expect(dashboard).not.toContain("state.caseOutcomes");
  });

  it("renders a refresh-compatible persisted Case score as provisional", () => {
    const hydrated = hydrateReadinessState({
      ...DEFAULT_READINESS_STATE,
      case: {
        status: "done",
        score: 61,
        statusLine: "1 case · provisional (partial report)",
        updatedAt: 1_000,
      },
    });

    expect(hydrated.case.score).toBe(61);
    expect(isProvisionalCaseResult(hydrated.case)).toBe(true);
    expect(dashboard).toContain('text: "Provisional"');
    expect(dashboard).toContain("Provisional interview score");
  });

  it("does not label complete or empty Case states as provisional", () => {
    expect(
      isProvisionalCaseResult({
        status: "done",
        score: 83,
        statusLine: "2 cases · full report",
      }),
    ).toBe(false);
    expect(isProvisionalCaseResult(DEFAULT_READINESS_STATE.case)).toBe(false);
    expect(dashboard).toContain('const valueLabel = has');
    expect(dashboard).toContain(': "Pending";');
  });

  it("keeps technical outcomes outside the dashboard module inputs", () => {
    const hydrated = hydrateReadinessState({
      ...DEFAULT_READINESS_STATE,
      fit: { status: "done", score: 78 },
      behavioural: { status: "done", score: 72 },
      case: { status: "done", score: 69, statusLine: "1 case · full report" },
      caseOutcomes: {
        technical: {
          caseId: "data_analyst_technical_round",
          caseTrack: "technical",
          latestScore: 97,
          bestScore: 97,
          attemptCount: 1,
          lastCompletedAt: 2_000,
          latestWasPartial: false,
          bestWasPartial: false,
          latestOutcomeId: "technical-1",
          recordedOutcomeIds: ["technical-1"],
        },
      },
    });

    expect(hydrated.case.score).toBe(69);
    expect(hydrated.caseOutcomes.technical.latestScore).toBe(97);
    expect(dashboard).not.toContain("caseOutcomes");
    expect(dashboard).toContain("overallReadiness()");
  });
});
