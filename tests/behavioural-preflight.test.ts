import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Behavioural preflight integration", () => {
  it("gates both the manual bootstrap and Vapi start behind the primary CTA", () => {
    const source = readFileSync("app/behavioural/page.tsx", "utf8");

    expect(source).toContain("Start behavioural interview");
    expect(source).toContain("startRequested={interviewStarted}");
    expect(source).toContain("onClick={beginInterview}");
    expect(source).toContain("voiceActive && !summary && !voiceSummary");
    expect(source).not.toContain("startedRef.current = true;\n    start();");
  });
});
