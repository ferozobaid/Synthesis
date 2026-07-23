import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/readiness-store", () => ({
  useReadiness: () => ({ setModule: vi.fn() }),
}));

vi.mock("@/components/CaseVoiceInterview", () => ({
  default: () => React.createElement("div", { "data-case-voice": "surface" }, "Voice interview"),
}));

describe("/case voice-only surface", () => {
  it("renders the voice case surface without a manual mode selector", async () => {
    vi.stubGlobal("React", React);
    const { default: CasePage } = await import("@/app/case/page");
    const html = renderToStaticMarkup(React.createElement(CasePage));

    // The page hosts the (server-selected) voice interview; case selection is
    // driven inside the component, not by a hardcoded page-level case.
    expect(html).toContain("Voice interview");
    expect(html).toContain("Live voice case interview");
    expect(html).not.toContain("Interview format");
    expect(html).not.toContain(">Manual<");
  });
});
