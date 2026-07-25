import { describe, it, expect } from "vitest";
import { generateQuestions } from "@/lib/behavioural/question-gen";
import { parseJD } from "@/lib/parsers/jd-parser";
import { MOCK_QUESTIONS, MOCK_JD_TEXT } from "@/lib/__mocks__/fixtures";

/** Count of bank questions that are always asked (industry is conditional). */
const CORE_COUNT = MOCK_QUESTIONS.filter((q) => q.conditional !== "industry").length;

describe("behavioural question generation", () => {
  it("opens with 'Tell me about yourself' as the first (scored) question", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst" });
    expect(qs[0].id).toBe("tell_me_about_yourself");
    expect(qs[1].id).toBe("role_motivation");
  });

  it("fills 'why this company' from the context company name", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { company: "National Bank of Canada" });
    const why = qs.find((q) => q.id === "why_this_company");
    expect(why?.question).toContain("National Bank of Canada");
    expect(why?.question).not.toContain("{{company}}");
  });

  it("makes the role-motivation question role-aware (Data Analyst → data analytics)", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst" });
    const role = qs.find((q) => q.id === "role_motivation");
    expect(role?.type).toBe("role_motivation");
    expect(role?.question).toBe("Why are you interested in working in data analytics?");
    expect(role?.question.toLowerCase()).not.toContain("consulting");
  });

  it("produces data-engineering wording for a Data Engineer", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Engineer" });
    const role = qs.find((q) => q.id === "role_motivation");
    expect(role?.question).toBe("Why are you interested in working in data engineering?");
  });

  it("still produces a consulting question for a consulting context", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Management Consultant" });
    const role = qs.find((q) => q.id === "role_motivation");
    expect(role?.question).toBe("Why do you want to work in consulting?");
  });

  it("falls back to a safe generic prompt when no role is known", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, {});
    const role = qs.find((q) => q.id === "role_motivation");
    expect(role?.id).toBe("role_motivation"); // stable id even without context
    expect(role?.question).toBe("Why are you interested in this type of role?");

    const why = qs.find((q) => q.id === "why_this_company");
    expect(why?.question).toContain("this company");
    expect(why?.question).not.toContain("{{company}}");
  });

  it("asks a distinct industry question, filled from the industry, when non-redundant", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst", industry: "banking" });
    const industry = qs.find((q) => q.id === "industry_motivation");
    expect(industry).toBeTruthy();
    expect(industry?.question).toBe("Why are you interested in working in banking?");
    expect(qs).toHaveLength(CORE_COUNT + 1);
  });

  it("drops the industry question when no industry is known", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst" });
    expect(qs.find((q) => q.id === "industry_motivation")).toBeUndefined();
    expect(qs).toHaveLength(CORE_COUNT);
  });

  it("drops the industry question when it would be redundant with the role family", () => {
    // Consultant → family "consulting"; industry "consulting" is redundant.
    const qs = generateQuestions(MOCK_QUESTIONS, {
      role: "Management Consultant",
      industry: "consulting",
    });
    expect(qs.find((q) => q.id === "industry_motivation")).toBeUndefined();
  });

  it("keeps the role-motivation and company questions distinct", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, {
      role: "Data Analyst",
      company: "National Bank of Canada",
    });
    const role = qs.find((q) => q.id === "role_motivation");
    const company = qs.find((q) => q.id === "why_this_company");
    expect(role?.question).not.toBe(company?.question);
    expect(company?.question).toContain("National Bank of Canada");
    expect(role?.question).not.toContain("National Bank of Canada");
  });

  it("accepts a raw parsed JD for back-compat and grounds motivation wording", () => {
    const jd = parseJD(MOCK_JD_TEXT);
    expect(jd.company).toBe("Revature");
    const qs = generateQuestions(MOCK_QUESTIONS, jd);
    const why = qs.find((q) => q.id === "why_this_company");
    expect(why?.question).toContain("Revature");
    // The mock JD role is a "…Consultant" → consulting family.
    const role = qs.find((q) => q.id === "role_motivation");
    expect(role?.question).toBe("Why do you want to work in consulting?");
  });

  it("leaves non-dynamic questions unchanged", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst" });
    const leadership = qs.find((q) => q.id === "leadership");
    const orig = MOCK_QUESTIONS.find((q) => q.id === "leadership");
    expect(leadership?.question).toBe(orig?.question);
  });

  it("places self-assessment (greatest strength) after the competency block", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst" });
    const strengthIdx = qs.findIndex((q) => q.id === "greatest_strength");
    const firstStarIdx = qs.findIndex((q) => q.type === "star");
    expect(strengthIdx).toBeGreaterThan(firstStarIdx);
    expect(qs[qs.length - 1].id).toBe("greatest_strength");
  });
});
