import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StageTracker } from "@/components/ui/StageTracker";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("responsive stage tracker", () => {
  it("exposes ordered step state without inline layout styles", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(
      React.createElement(StageTracker, {
        stages: ["Clarification", "Framework", "Analysis"],
        currentIdx: 1,
      }),
    );

    expect(html).toContain('class="stage-tracker stage-tracker--3"');
    expect(html).toContain('role="list"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("stage-tracker__connector");
    expect(html).not.toContain("style=");
  });

  it("uses compact tablet, phone, and narrow-phone layouts", () => {
    const styles = readFileSync("app/globals.css", "utf8");

    expect(styles).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.case-progress-panel \.stage-tracker\s*\{[^}]*grid-template-columns:\s*repeat\(3,/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.case-progress-panel \.stage-tracker\s*\{[^}]*grid-template-columns:\s*repeat\(2,/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 360px\)[\s\S]*?\.case-progress-panel \.stage-tracker\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
  });
});
