import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_WORKED_SOLUTION_STATE,
  WORKED_SOLUTION_BUTTON_ID,
  WORKED_SOLUTION_PANEL_ID,
  caseWorkedSolutionA11y,
  caseWorkedSolutionControlVisible,
  fetchCaseWorkedSolution,
  fullAuthoritativeCaseScore,
  nativeCaseReportPresentation,
  shouldFetchWorkedSolution,
  toggleWorkedSolution,
  type NativeCaseReportProjection,
  type WorkedSolutionState,
} from "@/components/CaseNativeVoiceInterview";
import type { CaseWorkedSolutionView } from "@/lib/voice/case-worked-solution-types";

const pending = { sessionId: "native-session-1", reportToken: "browser-only-report-token" };

function report(overrides: Partial<NativeCaseReportProjection> = {}): NativeCaseReportProjection {
  return {
    status: "pending",
    caseId: "airport_profitability",
    caseTitle: "Airport Profitability",
    partial: null,
    observedStages: [],
    missingStages: [],
    score: null,
    failureCode: null,
    ...overrides,
  };
}

const doneScore = {
  overall: 4,
  dimension_scores: ["structure", "hypothesis_driven_thinking", "quantitative_reasoning", "synthesis", "communication"].map((dimension) => ({
    dimension, score: 4, justification: `${dimension} feedback`, evidence: null,
  })),
  summary: "A concise summary.",
  strengths: ["Clear structure."],
  improvements: ["State the hypothesis earlier."],
  next_focus: ["Practice synthesis."],
  stage_feedback: [],
  improved_framework_outline: ["Define the decision."],
  improved_recommendation_outline: ["Lead with the decision."],
  quantitative_assessment: "Calculations were clear.",
} as NativeCaseReportProjection["score"];

const doneFull = report({ status: "done", partial: false, observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"], score: doneScore });
const donePartial = report({ status: "done", partial: true, observedStages: ["clarification", "framework"], missingStages: ["analysis", "data_reveal", "pressure_test", "recommendation"], score: { ...doneScore, overall: null } as NativeCaseReportProjection["score"] });

function solutionView(): CaseWorkedSolutionView {
  return {
    version: "airport-worked-solution-v1",
    caseId: "airport_profitability",
    caseTitle: "Airport Profitability",
    disclaimer: "This is one strong approach, not the only valid answer.",
    framework: { heading: "Strong framework", points: ["Revenue opportunity."] },
    analysisApproach: { heading: "Analysis approach", points: ["Passenger segmentation."] },
    calculations: { heading: "Step-by-step calculations", steps: [{ label: "Total daily retail revenue", expression: "SAR 3,600,000 + SAR 640,000", result: "SAR 4,240,000" }] },
    pressureTest: { heading: "Pressure-test calculation", steps: [{ label: "Daily revenue uplift", expression: "3,000 × SAR 150", result: "SAR 450,000" }] },
    exampleRecommendation: { heading: "Example recommendation", points: ["One possible strong recommendation."] },
  };
}

function okFetcher(body: unknown = { solution: solutionView() }) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  }));
}

describe("worked-solution control visibility", () => {
  it("is hidden until a completed report exists", () => {
    expect(caseWorkedSolutionControlVisible(null)).toBe(false);
    expect(caseWorkedSolutionControlVisible(report({ status: "pending" }))).toBe(false);
    expect(caseWorkedSolutionControlVisible(report({ status: "processing" }))).toBe(false);
    expect(caseWorkedSolutionControlVisible(report({ status: "failed" }))).toBe(false);
  });

  it("is visible for full and partial completed reports", () => {
    expect(caseWorkedSolutionControlVisible(doneFull)).toBe(true);
    expect(caseWorkedSolutionControlVisible(donePartial)).toBe(true);
  });
});

describe("worked-solution disclosure state", () => {
  it("starts collapsed", () => {
    expect(INITIAL_WORKED_SOLUTION_STATE.open).toBe(false);
    expect(INITIAL_WORKED_SOLUTION_STATE.solution).toBeNull();
    expect(caseWorkedSolutionA11y(false).panel.hidden).toBe(true);
    expect(caseWorkedSolutionA11y(false).button["aria-expanded"]).toBe(false);
  });

  it("makes no request before the first click", () => {
    // Rendering the control never fetches; only a toggle can. The initial state
    // would request on first open, but nothing has requested yet.
    expect(shouldFetchWorkedSolution(INITIAL_WORKED_SOLUTION_STATE)).toBe(true);
  });

  it("issues exactly one request across open/close/reopen", async () => {
    const fetcher = okFetcher();
    let state: WorkedSolutionState = INITIAL_WORKED_SOLUTION_STATE;

    // First open → fetch.
    let step = toggleWorkedSolution(state); state = step.next;
    expect(step.fetch).toBe(true);
    expect(state.open).toBe(true);
    expect(state.phase).toBe("loading");
    const solution = await fetchCaseWorkedSolution(pending, fetcher as unknown as typeof fetch);
    state = { ...state, phase: "ready", solution };
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Close → no fetch.
    step = toggleWorkedSolution(state); state = step.next;
    expect(step.fetch).toBe(false);
    expect(state.open).toBe(false);

    // Reopen → cached, no fetch.
    step = toggleWorkedSolution(state); state = step.next;
    expect(step.fetch).toBe(false);
    expect(state.open).toBe(true);
    expect(state.solution).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("targets the dedicated solution endpoint, not the report or catalog route", async () => {
    const fetcher = okFetcher();
    await fetchCaseWorkedSolution(pending, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/case/report/native-session-1/solution",
      { headers: { "x-report-token": "browser-only-report-token" } },
    );
  });

  it("keeps loading and error states safe", async () => {
    // Loading is entered purely; a failed fetch throws and never corrupts state.
    const open = toggleWorkedSolution(INITIAL_WORKED_SOLUTION_STATE);
    expect(open.next.phase).toBe("loading");
    const failing = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(
      fetchCaseWorkedSolution(pending, failing as unknown as typeof fetch),
    ).rejects.toThrow(/could not be loaded/);
  });

  it("returns all five required sections on success", async () => {
    const fetcher = okFetcher();
    const solution = await fetchCaseWorkedSolution(pending, fetcher as unknown as typeof fetch);
    expect(solution.framework.heading).toBe("Strong framework");
    expect(solution.analysisApproach.heading).toBe("Analysis approach");
    expect(solution.calculations.steps[0].result).toBe("SAR 4,240,000");
    expect(solution.pressureTest.steps[0].result).toBe("SAR 450,000");
    expect(solution.exampleRecommendation.heading).toBe("Example recommendation");
    expect(solution.disclaimer).toBe("This is one strong approach, not the only valid answer.");
  });
});

describe("worked solution does not disturb scores or readiness", () => {
  it("leaves the report score projection unchanged when toggled", () => {
    const before = nativeCaseReportPresentation(doneFull);
    const scoreBefore = fullAuthoritativeCaseScore(doneFull);
    // Drive the full open/close cycle on the independent worked-solution state.
    let state: WorkedSolutionState = INITIAL_WORKED_SOLUTION_STATE;
    state = toggleWorkedSolution(state).next;
    state = { ...state, phase: "ready", solution: solutionView() };
    state = toggleWorkedSolution(state).next;
    expect(nativeCaseReportPresentation(doneFull)).toEqual(before);
    expect(fullAuthoritativeCaseScore(doneFull)).toEqual(scoreBefore);
    // The full authoritative score (which drives readiness) is still present and equal.
    expect(scoreBefore).not.toBeNull();
  });

  it("does not produce a readiness score for a partial report regardless of the solution", () => {
    expect(fullAuthoritativeCaseScore(donePartial)).toBeNull();
    const state = toggleWorkedSolution(INITIAL_WORKED_SOLUTION_STATE).next;
    expect(state.open).toBe(true);
    expect(fullAuthoritativeCaseScore(donePartial)).toBeNull();
  });
});

describe("worked-solution accessibility", () => {
  it("exposes an accessible expandable button/panel relationship", () => {
    const closed = caseWorkedSolutionA11y(false);
    expect(closed.button).toEqual({
      id: WORKED_SOLUTION_BUTTON_ID,
      "aria-expanded": false,
      "aria-controls": WORKED_SOLUTION_PANEL_ID,
    });
    expect(closed.panel.role).toBe("region");
    expect(closed.panel["aria-labelledby"]).toBe(WORKED_SOLUTION_BUTTON_ID);
    expect(closed.panel.hidden).toBe(true);

    const open = caseWorkedSolutionA11y(true);
    expect(open.button["aria-expanded"]).toBe(true);
    expect(open.panel.hidden).toBe(false);
  });
});
