import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Behavioural preflight integration", () => {
  it("gates both the manual bootstrap and Vapi start behind the primary CTA", () => {
    const source = readFileSync("app/behavioural/page.tsx", "utf8");

    expect(source).toContain("Start behavioural interview");
    expect(source).toContain("startRequested={interviewStarted}");
    expect(source).toContain("onClick={beginInterview}");
    expect(source).toContain(
      "if (!hydrated || !targetReady || startedRef.current) return;",
    );
    expect(source).toContain("voiceActive && !summary && !voiceSummary");
    expect(source).not.toContain("startedRef.current = true;\n    start();");
  });

  it("requires an explicit personal or sample target before starting", () => {
    const source = readFileSync("app/behavioural/page.tsx", "utf8");

    expect(source).toContain("hasCompleteTarget(state)");
    expect(source).toContain("Set my role");
    expect(source).toContain("Load sample interview");
    expect(source).toContain("onClick={seedSample}");
    expect(source).toContain("targetReady ?");
  });

  it("clearly distinguishes sample and personalized interviews", () => {
    const source = readFileSync("app/behavioural/page.tsx", "utf8");

    expect(source).toContain("Sample interview ·");
    expect(source).toContain("Personalized for");
    expect(source).toContain("Start sample interview");
    expect(source).toContain("Use my role");
    expect(source).toContain("Change role");
  });
});
