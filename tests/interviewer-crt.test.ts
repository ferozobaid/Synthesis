import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared live interviewer CRT", () => {
  it("renders a self-contained monitor without the cinematic video", async () => {
    vi.stubGlobal("React", React);
    const { InterviewerAvatar } = await import(
      "@/components/interviewer/InterviewerAvatar"
    );
    const html = renderToStaticMarkup(
      React.createElement(InterviewerAvatar, {
        mode: "speaking",
        level: 0.8,
        variant: "stage",
      }),
    );

    expect(html).toContain("interviewer-crt");
    expect(html).toContain("interviewer-screen");
    expect(html).toContain("interviewer-wave");
    expect(html).not.toContain("<video");
  });

  it("keeps Case selection ahead of the live CRT session surface", () => {
    const source = readFileSync("components/CaseVoiceInterview.tsx", "utf8");
    const pickerReturn = source.indexOf("if (showPicker)");
    const avatarRender = source.indexOf("<InterviewerAvatar");

    expect(pickerReturn).toBeGreaterThan(-1);
    expect(avatarRender).toBeGreaterThan(pickerReturn);
  });

  it("strictly clips the waveform to forty by twenty percent of the display", () => {
    const styles = readFileSync("app/globals.css", "utf8");
    const crtStyles = styles.slice(styles.indexOf("/* Self-contained live CRT."));

    expect(crtStyles).toContain(".interviewer-screen {");
    expect(crtStyles).toMatch(/\.interviewer-screen\s*\{[^}]*overflow:\s*hidden;/s);
    expect(crtStyles).toMatch(
      /\.interviewer-wave\s*\{[^}]*max-width:\s*40%;[^}]*max-height:\s*20%;[^}]*overflow:\s*hidden;/s,
    );
  });

  it("keeps the compact Case monitor status on one fitted line", () => {
    const styles = readFileSync("app/globals.css", "utf8");
    const crtStyles = styles.slice(styles.indexOf("/* Self-contained live CRT."));

    expect(crtStyles).toMatch(
      /\.interviewer-stage--panel \.interviewer-screen__label\s*\{[^}]*font-size:\s*clamp\(4\.75px,[^}]*white-space:\s*nowrap;/s,
    );
    expect(crtStyles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.interviewer-stage--panel \.interviewer-screen__label\s*\{[^}]*font-size:\s*4\.5px;/s,
    );
  });
});
