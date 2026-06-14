/**
 * Mock fixtures so the three module UIs work on realistic data with no credentials.
 * Case content and the behavioural bank are loaded from the authored /context JSON.
 */
import beautify from "@/context/cases/beautify.json";
import diconsa from "@/context/cases/diconsa.json";
import questionBank from "@/context/behavioural/question_bank.json";
import seedAnswers from "@/context/behavioural/seed_answer_bank.json";
import type {
  AnswerBankEntry,
  BehaviouralQuestion,
  BehaviouralScore,
  CaseRecord,
  FitReport,
  Star,
} from "@/lib/types";

export const MOCK_USER_ID = "00000000-0000-0000-0000-000000000000";

const CASES = [beautify, diconsa] as unknown as CaseRecord[];
export function mockCases(): CaseRecord[] {
  return CASES;
}
export function mockCase(id: string): CaseRecord | undefined {
  return CASES.find((c) => c.id === id);
}

export const MOCK_QUESTIONS = (questionBank as { questions: BehaviouralQuestion[] }).questions;

type SeedAnswer = Star & { id: string; question: string; tags: string[] };
export const MOCK_SEED_ANSWERS = seedAnswers as unknown as SeedAnswer[];

export function mockAnswerBank(): AnswerBankEntry[] {
  return MOCK_SEED_ANSWERS.map((a) => ({
    ...a,
    user_id: MOCK_USER_ID,
    embedding: null,
    created_at: new Date(0).toISOString(),
  }));
}

export const mockFitReport: FitReport = {
  overall_score: 74,
  per_requirement: [
    { requirement: "SQL proficiency", status: "matched", evidence: "Built outlet-level reporting in SQL across regions", weight: 1, score: 0.92 },
    { requirement: "Python or R", status: "matched", evidence: "Automated analysis in Python (pandas)", weight: 1, score: 0.88 },
    { requirement: "Data visualization / BI tools", status: "partial", evidence: "Power BI dashboards for sales reviews", weight: 0.8, score: 0.6 },
    { requirement: "Statistical analysis", status: "partial", evidence: "A/B and funnel analysis", weight: 0.8, score: 0.55 },
    { requirement: "Bachelor's in a quantitative field", status: "matched", evidence: "BSc, Business Analytics", weight: 1, score: 0.9 },
    { requirement: "Cybersecurity / financial-services domain", status: "missing", evidence: null, weight: 0.4, score: 0.1 },
  ],
  top_strengths: [
    "Strong SQL + Python foundation",
    "Demonstrated stakeholder communication",
    "Quantified business impact",
  ],
  gaps: [
    "Limited exposure to the cybersecurity / financial-services domain",
    "Statistical depth could be stronger",
  ],
  missing_keywords: ["data modeling", "schemas", "cybersecurity"],
  recommendations: [
    "Add a line quantifying a statistical-modeling result",
    "Surface any finance- or security-adjacent project",
    "Mirror the JD's 'data modeling' language where it is genuinely true",
  ],
};

export const mockBehaviouralScore: BehaviouralScore = {
  dimension_scores: [
    { dimension: "STAR structure", score: 4, justification: "All four STAR elements present; the task could be sharper." },
    { dimension: "Specificity / evidence", score: 4, justification: "Concrete actions and a named method." },
    { dimension: "Ownership", score: 5, justification: "Clear first-person contribution." },
    { dimension: "Impact / result", score: 4, justification: "Quantified outcome." },
    { dimension: "Key-point coverage", score: 3, justification: "Covered the reset and rebuild; omitted the daily check-in cadence you'd planned." },
  ],
  overall: 4,
  covered_key_points: ["Reorganized the team", "Rebuilt a simpler model first"],
  missed_key_points: ["The 15-minute daily check-in cadence"],
  strengths: ["Clear ownership", "Quantified result"],
  improvements: ["State the task more crisply up front", "Mention the cadence change you used to de-risk"],
};
