import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateClientDocument } from "@/components/DocumentInput";

describe("document upload UI integration", () => {
  it("performs immediate client-side extension and size validation", () => {
    expect(validateClientDocument({ name: "resume.pdf", size: 100 })).toBeNull();
    expect(validateClientDocument({ name: "job.docx", size: 100 })).toBeNull();
    expect(validateClientDocument({ name: "notes.txt", size: 100 })).toBeNull();
    expect(validateClientDocument({ name: "resume.doc", size: 100 })).toMatch(/PDF, DOCX, or TXT/);
    expect(validateClientDocument({ name: "resume.pdf", size: 10 * 1024 * 1024 + 1 })).toMatch(
      /10 MB/,
    );
  });

  it("separates shared role setup from resume evidence", () => {
    const onboard = readFileSync("app/onboard/page.tsx", "utf8");
    const fit = readFileSync("app/fit/page.tsx", "utf8");

    expect(onboard).toContain('kind="job description"');
    expect(onboard).not.toContain('kind="resume"');
    expect(onboard).toContain('router.push("/fit")');
    expect(onboard).toContain("Continue to resume analysis");

    expect(fit).toContain('kind="resume"');
    expect(fit).not.toContain('kind="job description"');
    expect(fit).toContain("fit-target-gate");
    expect(fit).toContain('href="/onboard"');
    expect(fit).not.toContain("set a target role</Link> once");
  });
});
