import { beforeEach, describe, expect, it } from "vitest";
import {
  mapTranscriptToQuestions,
  scoreTranscript,
  type OrderedQuestion,
  type TranscriptMessage,
} from "@/lib/behavioural/transcript";
import { summarizeBehavioural } from "@/lib/behavioural/runner";
import { classifyBehaviouralQuestion } from "@/lib/behavioural/qualitative";
import { mockAnswerBank } from "@/lib/__mocks__/fixtures";
import realReport from "./fixtures/end-of-call-report.redacted.json";

// The 14 ordered questions exactly as the real call's assistant read them
// (Data Analyst @ Tenazx). The fixture is the canonical mapping case.
const QUESTIONS: OrderedQuestion[] = [
  { id: "q1", question: "Tell me about yourself." },
  { id: "q2", question: "Why are you interested in the Data Analyst role?" },
  { id: "q3", question: "Why do you want to work at Tenazx Inc?" },
  { id: "q4", question: "Why are you interested in consulting?" },
  { id: "q5", question: "What are your greatest strengths, and how have you applied them?" },
  { id: "q6", question: "Tell me about a time you failed and what you learned." },
  { id: "q7", question: "Tell me about a time you led a team through a difficult situation." },
  { id: "q8", question: "Tell me about a time you had a conflict with a teammate and how you resolved it." },
  { id: "q9", question: "Tell me about a time you dealt with significant ambiguity." },
  { id: "q10", question: "Tell me about a time you influenced others without formal authority." },
  { id: "q11", question: "Tell me about a time you used data to make a decision." },
  { id: "q12", question: "Tell me about a time you delivered high-quality work under a tight deadline." },
  { id: "q13", question: "Tell me about a time you worked cross-functionally." },
  { id: "q14", question: "Tell me about a time you went beyond what was asked." },
];

const REAL_MESSAGES = (realReport as { message: { artifact: { messages: TranscriptMessage[] } } })
  .message.artifact.messages;

const STRONG_STAR =
  "During my final-year consulting project, our team's churn model was unstable before the deadline. As team lead, I was responsible for getting us back on track. I organized a 45-minute reset, reassigned work by strength, and I rebuilt the model with a simpler logistic regression baseline using Python. As a result, we delivered on time and found three churn drivers explaining 62% of at-risk accounts.";

beforeEach(() => {
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("mapTranscriptToQuestions — real Vapi call", () => {
  const result = mapTranscriptToQuestions(QUESTIONS, REAL_MESSAGES);

  it("maps all 14 questions in the backend order", () => {
    expect(result.mapped).toHaveLength(14);
    expect(result.mapped.map((m) => m.questionId)).toEqual(QUESTIONS.map((q) => q.id));
    expect(result.usedPositionalFallback).toBe(false);
    expect(result.unansweredQuestionIds).toHaveLength(0);
  });

  it("discards pre-first-question small talk (never attributes it to Q1)", () => {
    const q1 = result.mapped[0].answer;
    // Msg5 + Msg7 belong to Q1; the Msg3 meta-complaint (before Q1) is discarded.
    expect(q1).toContain("silk");
    expect(q1).toContain("How are you");
    expect(q1).not.toContain("not asking me the question");
  });

  it("does not advance on a repeated Q1 or on small talk", () => {
    // The assistant re-reads Q1 (Msg6); the index must not jump past Q1 there.
    expect(result.mapped[0].confidence).toBe("high");
    // Q2's answer is the candidate's actual self-intro (given after Msg8).
    expect(result.mapped[1].answer).toContain("data analyst guy");
  });

  it("keeps a mid-question clarification with the same question (Q5)", () => {
    // Msg16 clarifies Q5 (no advance); Msg15 + Msg17 both belong to Q5.
    const q5 = result.mapped[4].answer;
    expect(q5).toContain("greatest strengths");
    expect(q5).toContain("Excel shortcuts");
  });

  it("attributes short / non-answers to the right question without advancing early", () => {
    // "Literally now?" is Q7's (non-)answer; the next real question is Q8.
    expect(result.mapped[6].answer).toContain("Literally now");
    expect(result.mapped[13].answer).toContain("Hmm");
  });
});

describe("mapTranscriptToQuestions — synthetic edge cases", () => {
  it("marks a skipped question as unanswered (no fabrication)", () => {
    const qs: OrderedQuestion[] = [
      { id: "a", question: "Tell me about yourself." },
      { id: "b", question: "Why do you want this specific role here?" },
      { id: "c", question: "What is your greatest weakness overall?" },
    ];
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "1) Tell me about yourself." },
      { role: "user", message: "I am a builder." },
      { role: "bot", message: "3) What is your greatest weakness overall?" },
      { role: "user", message: "Impatience sometimes." },
    ];
    const r = mapTranscriptToQuestions(qs, messages);
    expect(r.unansweredQuestionIds).toEqual(["b"]);
    expect(r.mapped[0].answer).toContain("builder");
    expect(r.mapped[2].answer).toContain("Impatience");
    expect(r.usedPositionalFallback).toBe(false);
  });

  it("falls back to positional mapping with reduced confidence when nothing matches", () => {
    const qs: OrderedQuestion[] = [
      { id: "a", question: "Describe your proudest engineering achievement." },
      { id: "b", question: "How do you handle disagreement with a manager?" },
    ];
    // Assistant lines that share no salient tokens with the questions.
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "Okay, moving on to the next one." },
      { role: "user", message: "First answer here." },
      { role: "bot", message: "Alright, and now another." },
      { role: "user", message: "Second answer here." },
    ];
    const r = mapTranscriptToQuestions(qs, messages);
    expect(r.usedPositionalFallback).toBe(true);
    expect(r.mapped[0].answer).toContain("First answer");
    expect(r.mapped[1].answer).toContain("Second answer");
    expect(r.mapped.every((m) => m.confidence !== "high")).toBe(true);
  });

  it("scores a partial (early-ended / max-duration) call and marks the rest unanswered", async () => {
    // Only the first 3 of 14 questions were reached before the call ended.
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "1) Tell me about yourself." },
      { role: "user", message: "I build data tools." },
      { role: "bot", message: "2) Why are you interested in the Data Analyst role?" },
      { role: "user", message: "I love working with data." },
      { role: "bot", message: "3) Why do you want to work at Tenazx Inc?" },
      { role: "user", message: "Strong team and mission." },
    ];
    const mapping = mapTranscriptToQuestions(QUESTIONS, messages);
    expect(mapping.usedPositionalFallback).toBe(false);
    expect(mapping.mapped.filter((m) => m.answer)).toHaveLength(3);
    expect(mapping.unansweredQuestionIds).toHaveLength(11);
    expect(mapping.unansweredQuestionIds).toEqual(QUESTIONS.slice(3).map((q) => q.id));

    const { report } = await scoreTranscript(QUESTIONS, messages, mockAnswerBank());
    expect(report.answered).toBe(3); // partial report over completed questions only
    expect(report.qualitative?.qualitative_attempted).toBe(false);
    expect(report.qualitative?.selected_model).toBe("claude-haiku-4-5");
    expect(report.qualitative?.qualitative_backend).toBe("deterministic_fallback");
    expect(report.qualitative?.fallback_reason).toBe("mock_mode");
    expect(report.qualitative?.partial_warning).toContain("not representative");
    expect(report.qualitative?.answers).toHaveLength(3);
    expect(report.qualitative?.answers[0]).toMatchObject({
      question_id: "q1",
      question_number: 1,
      question: QUESTIONS[0].question,
      question_type: "introduction",
    });
    expect(report.qualitative?.answers[0].candidate_excerpt.length).toBeLessThanOrEqual(220);
    expect(report.qualitative?.answers[0].assessment_confidence).toMatch(/high|medium|low/);
    expect(report.qualitative?.answers[0].missing_star_elements).toEqual([]);
    expect(report.qualitative?.answers[0].improved_answer_outline).toContain("background");
  });

  it("classifies known backend question types deterministically", () => {
    expect(classifyBehaviouralQuestion({ id: "tell_me_about_yourself", question: "Tell me about yourself.", type: "intro" })).toBe("introduction");
    expect(classifyBehaviouralQuestion({ id: "why_this_role", question: "Why are you interested in this role?", type: "motivation" })).toBe("motivation_role_fit");
    expect(classifyBehaviouralQuestion({ id: "why_this_company", question: "Why do you want to work at Revature?", type: "motivation", source: "parsed JD company name" })).toBe("company_fit");
    expect(classifyBehaviouralQuestion({ id: "greatest_strength", question: "What are your greatest strengths, and how have you applied them?", type: "self-assessment" })).toBe("self_assessment");
    expect(classifyBehaviouralQuestion({ id: "leadership", question: "Tell me about a time you led a team.", type: "star" })).toBe("competency_star");
  });

  it("does not apply STAR criticism to intro, role-interest, or company-interest questions", async () => {
    const qs: OrderedQuestion[] = [
      { id: "tell_me_about_yourself", question: "Tell me about yourself.", type: "intro" },
      { id: "why_this_role", question: "Why are you interested in this role?", type: "motivation" },
      { id: "why_this_company", question: "Why do you want to work at Revature?", type: "motivation", source: "parsed JD company name" },
      { id: "greatest_strength", question: "What are your greatest strengths, and how have you applied them?", type: "self-assessment" },
    ];
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "1) Tell me about yourself." },
      { role: "user", message: "I am a data analyst with dashboard and client project experience, and I am targeting analytics roles." },
      { role: "bot", message: "2) Why are you interested in this role?" },
      { role: "user", message: "I am interested in this role because it combines data analysis, business problem solving, and stakeholder communication." },
      { role: "bot", message: "3) Why do you want to work at Revature?" },
      { role: "user", message: "Revature interests me because the company develops technical talent and works with clients on practical technology problems." },
      { role: "bot", message: "4) What are your greatest strengths, and how have you applied them?" },
      { role: "user", message: "My strength is self-awareness. I use feedback from project reviews to improve how I communicate analysis in team settings." },
    ];

    const { report } = await scoreTranscript(qs, messages, mockAnswerBank());
    for (const answer of report.qualitative?.answers ?? []) {
      expect(answer.question_type).not.toBe("competency_star");
      expect(answer.missing_star_elements).toEqual([]);
      expect(answer.missing_elements.join(" ")).not.toMatch(/\bSTAR|Situation|Task|Action|Result\b/);
      expect(answer.weaknesses.join(" ")).not.toMatch(/\bSTAR|Situation|Task|Action|Result\b/);
    }
  });

  it("marks whether an answer did or did not address the question", async () => {
    const qs: OrderedQuestion[] = [
      { id: "role", question: "Why are you interested in the Data Analyst role?" },
      { id: "conflict", question: "Tell me about a time you had a conflict with a teammate and how you resolved it." },
    ];
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "1) Why are you interested in the Data Analyst role?" },
      { role: "user", message: "I am interested in the data analyst role because I like using data to solve business problems." },
      { role: "bot", message: "2) Tell me about a time you had a conflict with a teammate and how you resolved it." },
      { role: "user", message: "I don't know." },
    ];

    const { report } = await scoreTranscript(qs, messages, mockAnswerBank());
    expect(report.qualitative?.answers[0].addressed_question).toBe("yes");
    expect(report.qualitative?.answers[1].addressed_question).toBe("no");
    expect(report.qualitative?.answers[1].addressed_rationale).toContain("non-answer");
  });

  it("identifies missing STAR elements for thin answers", async () => {
    const qs: OrderedQuestion[] = [{ id: "data", question: "Tell me about a time you used data to make a decision." }];
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "1) Tell me about a time you used data to make a decision." },
      { role: "user", message: "I analyzed data." },
    ];

    const { report } = await scoreTranscript(qs, messages, mockAnswerBank());
    expect(report.qualitative?.answers[0].missing_star_elements).toEqual(
      expect.arrayContaining(["situation", "task", "result"]),
    );
    expect(report.qualitative?.answers[0].missing_elements).toContain(
      "A concrete result or impact.",
    );
  });

  it("does not praise non-answers or fabricate specific improvement evidence", async () => {
    const qs: OrderedQuestion[] = [{ id: "deadline", question: "Tell me about a time you delivered high-quality work under a tight deadline." }];
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "1) Tell me about a time you delivered high-quality work under a tight deadline." },
      { role: "user", message: "I don't know." },
    ];

    const { report } = await scoreTranscript(qs, messages, mockAnswerBank());
    const feedback = report.qualitative?.answers[0];
    expect(feedback?.addressed_question).toBe("no");
    expect(feedback?.strengths).toEqual([]);
    expect(feedback?.interview_engagement.rating).toBe("insufficient_evidence");
    expect(feedback?.insufficient_evidence).toBe(true);
    expect(feedback?.assessment_confidence).toBe("low");
    expect(feedback?.weaknesses.join(" ")).toContain("non-answer");
    expect(feedback?.improved_answer_outline).not.toContain("I don't know");
    expect(feedback?.improved_answer_outline).not.toContain("SQL");
  });

  it("does not positional-fallback a short partial call with a skipped early question", () => {
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "1) Tell me about yourself." },
      { role: "user", message: "I build data tools." },
      { role: "bot", message: "3) Why do you want to work at Tenazx Inc?" },
      { role: "user", message: "Strong team and mission." },
    ];
    const mapping = mapTranscriptToQuestions(QUESTIONS, messages);
    expect(mapping.usedPositionalFallback).toBe(false);
    expect(mapping.mapped[0].answer).toContain("data tools");
    expect(mapping.mapped[1].answer).toBe("");
    expect(mapping.mapped[2].answer).toContain("Strong team");
    expect(mapping.unansweredQuestionIds).toContain("q2");
  });

  it("handles an empty transcript without crashing", () => {
    const qs: OrderedQuestion[] = [{ id: "a", question: "Tell me about yourself." }];
    const r = mapTranscriptToQuestions(qs, []);
    expect(r.mapped).toHaveLength(1);
    expect(r.mapped[0].answer).toBe("");
    expect(r.unansweredQuestionIds).toEqual(["a"]);
    expect(r.usedPositionalFallback).toBe(false);
  });

  it("ignores non-conversational (system) turns", () => {
    const qs: OrderedQuestion[] = [{ id: "a", question: "Tell me about yourself." }];
    const messages: TranscriptMessage[] = [
      { role: "system", message: "Tell me about yourself. (this is the system prompt)" },
      { role: "bot", message: "1) Tell me about yourself." },
      { role: "user", message: "I build data tools." },
    ];
    const r = mapTranscriptToQuestions(qs, messages);
    expect(r.mapped[0].answer).toBe("I build data tools.");
  });
});

describe("scoreTranscript — reuses the existing engine", () => {
  it("scores every answered question and aggregates a report (mock mode)", async () => {
    const { session, report, mapping } = await scoreTranscript(
      QUESTIONS,
      REAL_MESSAGES,
      mockAnswerBank(),
      { sessionId: "test-session" },
    );

    // Question ordering comes only from the input list.
    expect(session.questions_asked?.map((q) => q.question_id)).toEqual(QUESTIONS.map((q) => q.id));
    // Every answered question is scored and retained for the report.
    expect(Object.keys(session.scores ?? {})).toHaveLength(mapping.mapped.filter((m) => m.answer).length);
    expect(report.answered).toBe(14);
    expect(typeof report.overall).toBe("number");
    expect(report.overall).toBeGreaterThanOrEqual(0);
    expect(report.dimension_averages.length).toBeGreaterThan(0);
    expect(report.qualitative?.partial_warning).toBeNull();
    expect(report.qualitative?.qualitative_attempted).toBe(false);
    expect(report.qualitative?.qualitative_backend).toBe("deterministic_fallback");
    expect(report.qualitative?.fallback_reason).toBe("mock_mode");
    expect(report.qualitative?.answers).toHaveLength(14);
    expect(report.qualitative?.overall_patterns.length).toBeGreaterThan(0);
    expect(report.qualitative?.top_three_priorities).toHaveLength(3);
    expect(report.qualitative?.answers[0].addressed_question).toMatch(/yes|partially|no/);
  });

  it("uses question metadata for post-call numeric scoring profiles", async () => {
    const qs: OrderedQuestion[] = [
      { id: "tell_me_about_yourself", question: "Tell me about yourself.", type: "intro" },
      { id: "greatest_strength", question: "What are your greatest strengths, and how have you applied them?", type: "self-assessment" },
      { id: "leadership", question: "Tell me about a time you led a team through a difficult situation.", type: "star" },
    ];
    const messages: TranscriptMessage[] = [
      { role: "bot", message: "1) Tell me about yourself." },
      { role: "user", message: "I am a data analyst with SQL dashboard and client reporting experience, targeting analytics roles." },
      { role: "bot", message: "2) What are your greatest strengths, and how have you applied them?" },
      { role: "user", message: "My strength is self-awareness. I use feedback from team reviews to improve how I explain analysis." },
      { role: "bot", message: "3) Tell me about a time you led a team through a difficult situation." },
      { role: "user", message: STRONG_STAR },
    ];

    const { session } = await scoreTranscript(qs, messages, mockAnswerBank());

    expect(session.scores?.tell_me_about_yourself?.dimension_scores.map((d) => d.dimension)).toEqual([
      "Professional positioning",
      "Relevance",
      "Specificity",
      "Clarity",
      "Concision",
    ]);
    expect(session.scores?.greatest_strength?.dimension_scores.map((d) => d.dimension)).toEqual([
      "Self-awareness",
      "Supporting evidence",
      "Role relevance",
      "Credibility",
      "Clarity",
    ]);
    expect(session.scores?.leadership?.dimension_scores.map((d) => d.dimension)).toContain("STAR structure");
  });

  it("keeps numeric summary calculations identical with qualitative feedback attached", async () => {
    const { session, report } = await scoreTranscript(
      QUESTIONS,
      REAL_MESSAGES,
      mockAnswerBank(),
      { sessionId: "test-session" },
    );
    const baseline = summarizeBehavioural(session);

    expect(report.qualitative).toBeTruthy();
    expect(report.overall).toBe(baseline.overall);
    expect(report.answered).toBe(baseline.answered);
    expect(report.dimension_averages).toEqual(baseline.dimension_averages);
    expect(report.feedback).toEqual(baseline.feedback);
  });

  it("gracefully falls back when real-mode qualitative generation cannot call Claude", async () => {
    const prevUseMocks = process.env.SYNTHESIS_USE_MOCKS;
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.SYNTHESIS_USE_MOCKS = "false";
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const messages: TranscriptMessage[] = [
        { role: "bot", message: "1) Why are you interested in the Data Analyst role?" },
        { role: "user", message: "I am interested in the data analyst role because I enjoy using data to solve business problems." },
      ];
      const { session, report } = await scoreTranscript(
        [{ id: "why_this_role", question: "Why are you interested in the Data Analyst role?", type: "motivation" }],
        messages,
        mockAnswerBank(),
      );
      const baseline = summarizeBehavioural(session);

      expect(report.qualitative?.answers[0].question_type).toBe("motivation_role_fit");
      expect(report.qualitative?.answers[0].candidate_excerpt).toContain("data analyst role");
      expect(report.qualitative?.qualitative_attempted).toBe(false);
      expect(report.qualitative?.qualitative_backend).toBe("deterministic_fallback");
      expect(report.qualitative?.fallback_reason).toBe("missing_key");
      expect(report.overall).toBe(baseline.overall);
      expect(report.dimension_averages).toEqual(baseline.dimension_averages);
    } finally {
      if (prevUseMocks === undefined) delete process.env.SYNTHESIS_USE_MOCKS;
      else process.env.SYNTHESIS_USE_MOCKS = prevUseMocks;
      if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    }
  });
});
