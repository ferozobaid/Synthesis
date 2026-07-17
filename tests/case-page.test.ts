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
  default: ({ caseId }: { caseId: string }) =>
    React.createElement("div", { "data-case-voice": caseId }, "Voice interview"),
}));

describe("/case voice-only surface", () => {
  it("opens directly on Beautify voice without the manual mode selector", async () => {
    vi.stubGlobal("React", React);
    const { default: CasePage } = await import("@/app/case/page");
    const html = renderToStaticMarkup(React.createElement(CasePage));

    expect(html).toContain("data-case-voice=\"beautify\"");
    expect(html).toContain("Beautify");
    expect(html).not.toContain("Interview format");
    expect(html).not.toContain(">Manual<");
    expect(html).not.toContain("Choose a case");
  });
});
