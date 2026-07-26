import { describe, expect, it } from "vitest";
import {
  buildPersonalizedTarget,
  commitReadinessTarget,
  DEFAULT_READINESS_STATE,
  hasCompleteTarget,
  hydrateReadinessState,
  SAMPLE_READINESS_STATE,
  SAMPLE_TARGET,
  type ReadinessState,
  type Target,
} from "@/components/readiness-store";

const PERSONAL_TARGET: Target = {
  role: "Product Manager",
  company: "Northstar",
  jdText: "Title: Product Manager\nCompany: Northstar",
  resumeText: "Candidate resume",
};

function personalizedState(
  target: Target = PERSONAL_TARGET,
): ReadinessState {
  return {
    ...DEFAULT_READINESS_STATE,
    target,
    targetSource: "personalized",
  };
}

describe("readiness target-source state", () => {
  it("hydrates empty storage as unset", () => {
    expect(hydrateReadinessState(null)).toEqual(DEFAULT_READINESS_STATE);
    expect(hasCompleteTarget(hydrateReadinessState(null))).toBe(false);
  });

  it("migrates the exact legacy Tenazx candidate into sample mode", () => {
    const hydrated = hydrateReadinessState({
      target: SAMPLE_TARGET,
      fit: { status: "done", score: 73, statusLine: "Sample score" },
    });

    expect(hydrated.targetSource).toBe("sample");
    expect(hydrated.fit).toMatchObject({
      status: "done",
      score: 73,
      statusLine: "Sample score",
    });
    expect(hasCompleteTarget(hydrated)).toBe(true);
  });

  it("migrates other non-empty legacy targets into personalized mode", () => {
    const hydrated = hydrateReadinessState({ target: PERSONAL_TARGET });
    expect(hydrated.targetSource).toBe("personalized");
    expect(hydrated.target).toEqual(PERSONAL_TARGET);
  });

  it("honors an explicit persisted target source", () => {
    const hydrated = hydrateReadinessState({
      target: PERSONAL_TARGET,
      targetSource: "sample",
    });
    expect(hydrated.targetSource).toBe("sample");
  });

  it("preserves results when committing an unchanged target", () => {
    const current: ReadinessState = {
      ...personalizedState(),
      fit: { status: "done", score: 82 },
    };
    const committed = commitReadinessTarget(
      current,
      PERSONAL_TARGET,
      "personalized",
    );

    expect(committed.fit).toEqual(current.fit);
    expect(committed.targetSource).toBe("personalized");
  });

  it("invalidates module results when the target materially changes", () => {
    const current: ReadinessState = {
      ...personalizedState(),
      fit: { status: "done", score: 82 },
      behavioural: { status: "in_progress", score: null },
    };
    const committed = commitReadinessTarget(
      current,
      { ...PERSONAL_TARGET, role: "Strategy Manager" },
      "personalized",
    );

    expect(committed.fit).toEqual({ status: "not_started", score: null });
    expect(committed.behavioural).toEqual({
      status: "not_started",
      score: null,
    });
    expect(committed.targetSource).toBe("personalized");
  });

  it("preserves a personal resume while changing roles", () => {
    expect(
      buildPersonalizedTarget(personalizedState(), {
        role: "Strategy Manager",
        company: "Northstar",
        jdText: "New role description",
      }).resumeText,
    ).toBe("Candidate resume");
  });

  it("discards the bundled resume when leaving sample mode", () => {
    expect(
      buildPersonalizedTarget(SAMPLE_READINESS_STATE, {
        role: "Strategy Manager",
        company: "Northstar",
        jdText: "New role description",
      }).resumeText,
    ).toBe("");
  });

  it("preserves a user replacement resume when leaving sample mode", () => {
    const sampleWithPersonalResume: ReadinessState = {
      ...SAMPLE_READINESS_STATE,
      target: {
        ...SAMPLE_TARGET,
        resumeText: "My replacement resume",
      },
    };

    expect(
      buildPersonalizedTarget(sampleWithPersonalResume, {
        role: "Strategy Manager",
        company: "Northstar",
        jdText: "New role description",
      }).resumeText,
    ).toBe("My replacement resume");
  });
});
