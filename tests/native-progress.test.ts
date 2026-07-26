import { describe, expect, it } from "vitest";
import {
  CLICKSTREAM_STAGE_LABELS,
  STRATEGY_STAGE_LABELS,
  isTechnicalNativeCase,
  nativeProgressDefinition,
} from "@/lib/voice/native-progress";
import { CASE_REPORT_STAGES } from "@/lib/voice/case-transcript";
import {
  advanceNativeCaseLiveProgress,
  initialNativeCaseLiveProgress,
  type NativeCaseLiveProgress,
} from "@/lib/voice/case-native-live";

const CLICKSTREAM = "data_engineer_clickstream";
const DA_ROUND = "data_analyst_technical_round";
const DE_ROUND = "data_engineer_technical_round";
const AIRPORT = "airport_profitability";
const GCC = "gcc_premium_gym_market_entry";

function speak(
  progress: NativeCaseLiveProgress,
  caseId: string,
  text: string,
  at = 1_000,
): NativeCaseLiveProgress {
  return advanceNativeCaseLiveProgress(progress, caseId, { role: "assistant", text }, at);
}

/** Walk every step anchor in order and collect the resulting stage indices. */
function walkAllSteps(caseId: string): number[] {
  const definition = nativeProgressDefinition(caseId)!;
  let progress = initialNativeCaseLiveProgress();
  const indices: number[] = [];
  for (const step of definition.steps) {
    progress = speak(progress, caseId, step.anchor);
    indices.push(progress.stageIndex);
  }
  return indices;
}

describe("evaluator-specific progress definitions", () => {
  it("Clickstream shows the six technical system-design steps", () => {
    const definition = nativeProgressDefinition(CLICKSTREAM)!;
    expect(definition.kind).toBe("case_stage");
    expect(definition.steps.map((s) => s.label)).toEqual([
      "Clarification",
      "High-level design",
      "Ingestion & schema",
      "Scale & stream design",
      "Reliability & edge cases",
      "Final recommendation",
    ]);
  });

  it("Clickstream keeps the unchanged internal stage ids and their order", () => {
    const definition = nativeProgressDefinition(CLICKSTREAM)!;
    expect(definition.steps.map((s) => s.id)).toEqual([...CASE_REPORT_STAGES]);
  });

  it("Data Analyst shows its five real question titles", () => {
    const definition = nativeProgressDefinition(DA_ROUND)!;
    expect(definition.kind).toBe("question_bank");
    expect(definition.steps.map((s) => s.label)).toEqual([
      "Monthly Revenue Query",
      "Conversion Rate Definition",
      "Weekly Sales Dashboard",
      "Regional Active-User Drop",
      "Checkout Experiment Result",
    ]);
  });

  it("Data Engineer shows its five real question titles", () => {
    const definition = nativeProgressDefinition(DE_ROUND)!;
    expect(definition.kind).toBe("question_bank");
    expect(definition.steps.map((s) => s.label)).toEqual([
      "Simple Sales Data Model",
      "Daily Multi-Source Pipeline",
      "Revenue Drop Check",
      "Pipeline Slowdown",
      "Unexpected Schema Change",
    ]);
  });

  it("Airport and GCC Gym retain the existing strategy progress", () => {
    for (const caseId of [AIRPORT, GCC]) {
      const definition = nativeProgressDefinition(caseId)!;
      expect(definition.kind).toBe("strategy");
      expect(definition.steps.map((s) => s.label)).toEqual([...STRATEGY_STAGE_LABELS]);
      expect(definition.steps.map((s) => s.id)).toEqual([...CASE_REPORT_STAGES]);
    }
  });

  it("classifies only the three technical experiences as technical", () => {
    expect(isTechnicalNativeCase(CLICKSTREAM)).toBe(true);
    expect(isTechnicalNativeCase(DA_ROUND)).toBe(true);
    expect(isTechnicalNativeCase(DE_ROUND)).toBe(true);
    expect(isTechnicalNativeCase(AIRPORT)).toBe(false);
    expect(isTechnicalNativeCase(GCC)).toBe(false);
  });

  it("returns null for a case with no native progress definition", () => {
    expect(nativeProgressDefinition("not_a_case")).toBeNull();
  });

  it("the strategy labels are not reused for Clickstream", () => {
    expect(CLICKSTREAM_STAGE_LABELS).not.toEqual(STRATEGY_STAGE_LABELS);
  });
});

describe("live progress counts (0 of N through N of N)", () => {
  it("Clickstream advances 0 of 6 through 6 of 6", () => {
    const definition = nativeProgressDefinition(CLICKSTREAM)!;
    expect(definition.steps).toHaveLength(6);
    expect(initialNativeCaseLiveProgress().stageIndex + 1).toBe(0);
    expect(walkAllSteps(CLICKSTREAM)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("Data Analyst advances 0 of 5 through 5 of 5", () => {
    expect(nativeProgressDefinition(DA_ROUND)!.steps).toHaveLength(5);
    expect(walkAllSteps(DA_ROUND)).toEqual([0, 1, 2, 3, 4]);
  });

  it("Data Engineer advances 0 of 5 through 5 of 5", () => {
    expect(nativeProgressDefinition(DE_ROUND)!.steps).toHaveLength(5);
    expect(walkAllSteps(DE_ROUND)).toEqual([0, 1, 2, 3, 4]);
  });

  it("the question-bank rounds no longer stall at index -1 (the regression)", () => {
    const first = nativeProgressDefinition(DA_ROUND)!.steps[0];
    const progress = speak(initialNativeCaseLiveProgress(), DA_ROUND, first.anchor);
    expect(progress.stageIndex).toBe(0);
    expect(progress.startedAt).toBe(1_000);
  });

  it("candidate speech never advances progress", () => {
    const first = nativeProgressDefinition(DE_ROUND)!.steps[0];
    const progress = advanceNativeCaseLiveProgress(
      initialNativeCaseLiveProgress(),
      DE_ROUND,
      { role: "user", text: first.anchor },
      1_000,
    );
    expect(progress.stageIndex).toBe(-1);
  });

  it("progress never regresses when an earlier anchor is repeated", () => {
    const steps = nativeProgressDefinition(DA_ROUND)!.steps;
    let progress = speak(initialNativeCaseLiveProgress(), DA_ROUND, steps[2].anchor);
    expect(progress.stageIndex).toBe(2);
    progress = speak(progress, DA_ROUND, steps[0].anchor, 2_000);
    expect(progress.stageIndex).toBe(2);
  });
});
