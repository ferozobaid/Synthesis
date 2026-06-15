import { describe, it, expect } from "vitest";
import { generateQuestions } from "@/lib/behavioural/question-gen";
import { parseJD } from "@/lib/parsers/jd-parser";
import { MOCK_QUESTIONS, MOCK_JD_TEXT } from "@/lib/__mocks__/fixtures";

describe("behavioural question generation", () => {
  it("fills 'why this company' from the parsed JD company name", () => {
    const jd = parseJD(MOCK_JD_TEXT);
    expect(jd.company).toBe("Revature");

    const qs = generateQuestions(MOCK_QUESTIONS, jd);
    const why = qs.find((q) => q.id === "why_this_company");
    expect(why?.question).toContain("Revature");
    expect(why?.question).not.toContain("{{company}}");
  });

  it("sharpens 'why this role' with the parsed role title", () => {
    const jd = parseJD(MOCK_JD_TEXT);
    expect(jd.role_title).toBeTruthy();

    const qs = generateQuestions(MOCK_QUESTIONS, jd);
    const role = qs.find((q) => q.id === "why_this_role");
    expect(role?.question).toContain(jd.role_title as string);
  });

  it("falls back to a generic company and generic role when no JD is provided", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, null);

    const why = qs.find((q) => q.id === "why_this_company");
    expect(why?.question).toContain("this company");
    expect(why?.question).not.toContain("{{company}}");

    const role = qs.find((q) => q.id === "why_this_role");
    expect(role?.question).toBe("Why are you interested in this role?");
  });

  it("leaves non-dynamic questions unchanged", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, parseJD(MOCK_JD_TEXT));
    const leadership = qs.find((q) => q.id === "leadership");
    const orig = MOCK_QUESTIONS.find((q) => q.id === "leadership");
    expect(leadership?.question).toBe(orig?.question);
    expect(qs).toHaveLength(MOCK_QUESTIONS.length);
  });
});
