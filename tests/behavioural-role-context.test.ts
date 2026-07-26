import { describe, it, expect } from "vitest";
import {
  roleMotivationQuestion,
  roleFamilyLabel,
  shouldAskIndustry,
  isValidIndustry,
  GENERIC_ROLE_MOTIVATION,
} from "@/lib/behavioural/role-context";
import { generateQuestions } from "@/lib/behavioural/question-gen";
import { startBehavioural } from "@/lib/behavioural/runner";
import { MOCK_QUESTIONS, MOCK_JD_TEXT } from "@/lib/__mocks__/fixtures";

describe("role-motivation wording (deterministic, role-aware)", () => {
  it("maps common roles to idiomatic function-motivation questions", () => {
    expect(roleMotivationQuestion("Data Analyst")).toBe(
      "Why are you interested in working in data analytics?",
    );
    expect(roleMotivationQuestion("Data Engineer")).toBe(
      "Why are you interested in working in data engineering?",
    );
    expect(roleMotivationQuestion("Product Manager")).toBe(
      "Why are you interested in working in product management?",
    );
    expect(roleMotivationQuestion("Business Analyst")).toBe(
      "Why are you interested in working in business analysis?",
    );
    expect(roleMotivationQuestion("AI Solutions Consultant")).toBe(
      "Why are you interested in building AI solutions?",
    );
    expect(roleMotivationQuestion("Management Consultant")).toBe(
      "Why do you want to work in consulting?",
    );
  });

  it("keeps a known-but-unmapped role role-aware without inventing a family", () => {
    expect(roleMotivationQuestion("Underwriting Actuary")).toBe(
      "Why are you interested in working as an Underwriting Actuary?",
    );
  });

  it("falls back to a safe generic prompt when no role is known", () => {
    expect(roleMotivationQuestion(null)).toBe(GENERIC_ROLE_MOTIVATION);
    expect(roleMotivationQuestion("")).toBe(GENERIC_ROLE_MOTIVATION);
    expect(roleMotivationQuestion(undefined)).toBe("Why are you interested in this type of role?");
  });

  it("never emits 'consulting' for a data role", () => {
    expect(roleMotivationQuestion("Data Analyst").toLowerCase()).not.toContain("consulting");
    expect(roleMotivationQuestion("Data Engineer").toLowerCase()).not.toContain("consulting");
  });
});

describe("role family + industry de-duplication", () => {
  it("labels the role family from the role (or JD domain)", () => {
    expect(roleFamilyLabel("Data Analyst")).toBe("data analytics");
    expect(roleFamilyLabel("Senior Data Engineer")).toBe("data engineering");
    expect(roleFamilyLabel(null, "consulting")).toBe("consulting");
    expect(roleFamilyLabel("Curator of Antiquities")).toBeNull();
  });

  it("asks industry only when a distinct, non-redundant industry is known", () => {
    expect(shouldAskIndustry("banking", { roleFamily: "data analytics", role: "Data Analyst" })).toBe(true);
    expect(shouldAskIndustry(null, { roleFamily: "data analytics" })).toBe(false);
    expect(shouldAskIndustry("consulting", { roleFamily: "consulting" })).toBe(false);
    expect(shouldAskIndustry("Tenazx", { company: "Tenazx Inc" })).toBe(false);
  });
});

describe("malformed / placeholder industry sanitization", () => {
  const JUNK = ["N/A", "NA", "n/a", "none", "None", "unknown", "Unknown", "not specified", "unspecified", "null", "undefined", "-", "TBD", "other"];

  it("treats placeholder-like industry values as missing", () => {
    for (const v of JUNK) {
      expect(isValidIndustry(v)).toBe(false);
    }
  });

  it("treats empty and whitespace-only industry values as missing", () => {
    expect(isValidIndustry("")).toBe(false);
    expect(isValidIndustry("   ")).toBe(false);
    expect(isValidIndustry("\t\n")).toBe(false);
    expect(isValidIndustry(null)).toBe(false);
    expect(isValidIndustry(undefined)).toBe(false);
  });

  it("preserves legitimate industries", () => {
    for (const v of ["banking", "healthcare", "technology", "retail", "energy", "consulting", "financial services"]) {
      expect(isValidIndustry(v)).toBe(true);
    }
  });

  it("does not create an industry question for 'N/A'", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst", industry: "N/A" });
    expect(qs.find((q) => q.id === "industry_motivation")).toBeUndefined();
  });

  it("does not create an industry question for 'unknown'", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst", industry: "unknown" });
    expect(qs.find((q) => q.id === "industry_motivation")).toBeUndefined();
  });

  it("does not create an industry question for whitespace", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst", industry: "   " });
    expect(qs.find((q) => q.id === "industry_motivation")).toBeUndefined();
  });

  it("still creates the industry question for a legitimate value ('banking')", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst", industry: "banking" });
    const ind = qs.find((q) => q.id === "industry_motivation");
    expect(ind?.question).toBe("Why are you interested in working in banking?");
  });

  it("keeps question numbering contiguous after an invalid industry is omitted", () => {
    const qs = generateQuestions(MOCK_QUESTIONS, { role: "Data Analyst", industry: "N/A" });
    // No industry question, and the surviving order is a clean 1..N with no gap.
    expect(qs.find((q) => q.id === "industry_motivation")).toBeUndefined();
    expect(qs[0].id).toBe("tell_me_about_yourself");
    expect(qs[1].id).toBe("role_motivation");
    expect(qs[2].id).toBe("why_this_company");
    expect(qs[3].id).toBe("time_you_failed"); // STAR block follows immediately, no hole
    expect(qs[qs.length - 1].id).toBe("greatest_strength");
    // Contiguity: numbering the array yields exactly 1..length with none skipped.
    const numbers = qs.map((_, i) => i + 1);
    expect(numbers).toEqual(Array.from({ length: qs.length }, (_, i) => i + 1));
  });
});

describe("startBehavioural role context precedence", () => {
  it("uses the explicit target role over the parsed JD for motivation wording", () => {
    // JD role is a "…Consultant"; explicit target overrides it to a data role.
    const res = startBehavioural({
      questionBank: MOCK_QUESTIONS,
      jdText: MOCK_JD_TEXT,
      targetRole: "Data Analyst",
      targetCompany: "National Bank of Canada",
    });
    const role = res.questions.find((q) => q.id === "role_motivation");
    expect(role?.question).toBe("Why are you interested in working in data analytics?");
    const company = res.questions.find((q) => q.id === "why_this_company");
    expect(company?.question).toContain("National Bank of Canada");
  });

  it("puts 'Tell me about yourself' first and role motivation second (readiness is not a scored question)", () => {
    const res = startBehavioural({ questionBank: MOCK_QUESTIONS, targetRole: "Data Engineer" });
    expect(res.questions[0].id).toBe("tell_me_about_yourself");
    expect(res.questions[1].id).toBe("role_motivation");
    // No readiness/"are you ready" prompt is ever part of the scored question set.
    const hasReadiness = res.questions.some((q) => /ready to begin|are you ready/i.test(q.question));
    expect(hasReadiness).toBe(false);
  });

  it("works with no role, no company, and no JD (signed-out / no context)", () => {
    const res = startBehavioural({ questionBank: MOCK_QUESTIONS });
    const role = res.questions.find((q) => q.id === "role_motivation");
    expect(role?.question).toBe("Why are you interested in this type of role?");
    expect(res.questions.find((q) => q.id === "industry_motivation")).toBeUndefined();
    expect(res.questions[0].id).toBe("tell_me_about_yourself");
  });
});
