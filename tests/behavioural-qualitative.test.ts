import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
}));

vi.mock("@/lib/claude", () => ({
  complete: completeMock,
  extractJSON: (text: string) => {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object found in model response");
    return JSON.parse(text.slice(start, end + 1));
  },
}));

import { buildBehaviouralQualitativeReport } from "@/lib/behavioural/qualitative";
import type { TranscriptMapping } from "@/lib/behavioural/transcript";
import type { BehaviouralScore } from "@/lib/types";

const score: BehaviouralScore = {
  dimension_scores: [
    { dimension: "STAR structure", score: 2, justification: "" },
    { dimension: "Specificity", score: 3, justification: "" },
    { dimension: "Ownership", score: 3, justification: "" },
    { dimension: "Impact", score: 2, justification: "" },
    { dimension: "Key Points Covered", score: 3, justification: "" },
  ],
  overall: 2.6,
  covered_key_points: [],
  missed_key_points: [],
  strengths: [],
  improvements: [],
};

function mapping(answer: string): TranscriptMapping {
  return {
    usedPositionalFallback: false,
    unansweredQuestionIds: [],
    mapped: [
      {
        questionId: "why_this_role",
        question: "Why are you interested in the Data Analyst role?",
        answer,
        confidence: "high",
        type: "motivation",
      },
    ],
  };
}

beforeEach(() => {
  completeMock.mockReset();
  process.env.SYNTHESIS_USE_MOCKS = "false";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
});

describe("buildBehaviouralQualitativeReport", () => {
  it("falls back deterministically when the structured-output response is invalid JSON", async () => {
    completeMock.mockResolvedValue("not json");

    const report = await buildBehaviouralQualitativeReport({
      mapping: mapping("I am interested in the data analyst role because I enjoy using data to solve business problems."),
      scores: { why_this_role: score },
      dimensionAverages: [{ dimension: "Impact", average: 2 }],
      totalQuestions: 1,
    });

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(report.answers[0].question_type).toBe("motivation_role_fit");
    expect(report.answers[0].candidate_excerpt).toContain("data analyst role");
    expect(report.answers[0].candidate_excerpt.length).toBeLessThanOrEqual(220);
    expect(report.answers[0].missing_star_elements).toEqual([]);
  });

  it("keeps excerpts and question types server-owned and strips STAR criticism from fit questions", async () => {
    completeMock.mockResolvedValue(JSON.stringify({
      overall_patterns: ["Pattern from model"],
      top_three_priorities: ["Priority 1", "Priority 2", "Priority 3"],
      answers: [
        {
          question_id: "why_this_role",
          question_type: "competency_star",
          candidate_excerpt: "Invented model excerpt.",
          addressed_question: "yes",
          addressed_rationale: "It has no STAR Situation.",
          strengths: ["Shows role interest."],
          weaknesses: ["Missing STAR Situation."],
          professionalism: { rating: "strong", rationale: "Professional, but no STAR Result." },
          interview_engagement: { rating: "strong", rationale: "Responsive and effortful." },
          clarity_relevance: { rating: "strong", rationale: "Relevant to the role." },
          missing_elements: ["Missing Result."],
          improved_answer_outline: "Use STAR with a clear Situation, Task, Action, and Result.",
          insufficient_evidence: false,
          insufficient_evidence_reason: null,
          confidence: "high",
        },
      ],
    }));

    const report = await buildBehaviouralQualitativeReport({
      mapping: mapping("I am interested in this role because it combines analytics, stakeholder communication, and practical business problem solving."),
      scores: { why_this_role: score },
      dimensionAverages: [{ dimension: "Impact", average: 2 }],
      totalQuestions: 1,
    });
    const answer = report.answers[0];

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(answer.question_type).toBe("motivation_role_fit");
    expect(answer.candidate_excerpt).not.toBe("Invented model excerpt.");
    expect(answer.candidate_excerpt).toContain("interested in this role");
    expect(answer.missing_star_elements).toEqual([]);
    expect(answer.addressed_rationale).not.toMatch(/\bSTAR|Situation|Task|Action|Result\b/);
    expect(answer.weaknesses.join(" ")).not.toMatch(/\bSTAR|Situation|Task|Action|Result\b/);
    expect(answer.professionalism.rationale).not.toMatch(/\bSTAR|Situation|Task|Action|Result\b/);
    expect(answer.improved_answer_outline).not.toMatch(/\bSTAR|Situation|Task|Action|Result\b/);
  });
});
