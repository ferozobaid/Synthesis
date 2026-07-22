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

  it("uses the shared upload component for both resume and JD on both entry screens", () => {
    for (const path of ["app/onboard/page.tsx", "app/fit/page.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('kind="resume"');
      expect(source).toContain('kind="job description"');
    }
  });
});
