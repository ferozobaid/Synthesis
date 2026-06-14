import { describe, it, expect } from "vitest";
import {
  cleanResumeText,
  stripLeadingTitleLine,
  extractSkills,
  parseResume,
} from "@/lib/parsers/resume-parser";
import { parseJD } from "@/lib/parsers/jd-parser";

describe("resume parser — EDA cleaning", () => {
  it("drops the 'Company Name' privacy placeholder", () => {
    expect(cleanResumeText("Worked at Company Name as an analyst")).not.toContain("Company Name");
  });

  it("normalizes the full-width dash (U+FF0D)", () => {
    expect(cleanResumeText("2019－2021")).toContain("2019-2021");
  });

  it("strips a leading ALL-CAPS title line (defeats label leakage)", () => {
    expect(stripLeadingTitleLine("INFORMATION TECHNOLOGY\nJane Doe")).not.toMatch(/^INFORMATION TECHNOLOGY/);
  });

  it("extracts known skills", () => {
    const skills = extractSkills("Built pipelines in SQL and Python with Power BI");
    expect(skills).toEqual(expect.arrayContaining(["sql", "python", "power bi"]));
  });

  it("parseResume returns cleaned raw_text and skills", () => {
    const p = parseResume("DATA ANALYST\nSkills: SQL, Python\nExperience\n- did things in SQL across regions");
    expect(p.skills.length).toBeGreaterThan(0);
    expect(p.raw_text).not.toMatch(/^DATA ANALYST/);
  });
});

describe("jd parser", () => {
  it("reads company/title headers and classifies requirements", () => {
    const jd = parseJD(
      "Title: Data Analyst\nCompany: Acme\nRequired: strong SQL and Python. A Bachelor's degree is required. Experience with finance is a plus.",
    );
    expect(jd.company).toBe("Acme");
    expect(jd.role_title).toBe("Data Analyst");
    expect(jd.must_have.length).toBeGreaterThan(0);
    expect(jd.nice_to_have.some((r) => /plus/i.test(r.text))).toBe(true);
  });
});
