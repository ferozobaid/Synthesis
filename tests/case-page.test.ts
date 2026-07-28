import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const recordCaseOutcome = vi.fn();
vi.mock("@/components/readiness-store", () => ({
  useReadiness: () => ({ setModule: vi.fn(), recordCaseOutcome }),
}));

vi.mock("@/components/CaseVoiceInterview", () => ({
  default: () => React.createElement("div", { "data-case-voice": "surface" }, "Voice interview"),
}));

describe("/case voice-only surface", () => {
  it("renders The GRID around the current voice surface without a manual mode selector", async () => {
    vi.stubGlobal("React", React);
    const { default: CasePage } = await import("@/app/case/page");
    const html = renderToStaticMarkup(React.createElement(CasePage));

    // The page hosts the (server-selected) voice interview; case selection is
    // driven inside the component, not by a hardcoded page-level case.
    expect(html).toContain("Voice interview");
    expect(html).toContain("The GRID");
    expect(html).toContain("Live interview simulations");
    expect(html).not.toContain("Case Coach");
    expect(html).not.toContain("Interview format");
    expect(html).not.toContain(">Manual<");
  });

  it("routes every completed case through the idempotent outcome recorder", async () => {
    const source = readFileSync("app/case/page.tsx", "utf8");

    // The single recording path; the store decides Strategy vs Technical.
    expect(source).toContain("recordCaseOutcome({");
    expect(source).toContain("caseTrack: outcome.caseTrack");
    expect(source).toContain("outcomeId: outcome.outcomeId");
    expect(source).toContain("partial: outcome.partial");

    // The old suppression gate that silently dropped technical and partial
    // results must not come back.
    expect(source).not.toContain("contributesToCaseReadiness");
    expect(source).not.toContain('setModule("case"');
  });
});
