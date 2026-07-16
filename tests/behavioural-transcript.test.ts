import { describe, expect, it } from "vitest";
import {
  mapTranscriptToQuestions,
  scoreTranscript,
  type OrderedQuestion,
  type TranscriptMessage,
} from "@/lib/behavioural/transcript";
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

  it("handles an empty transcript without crashing", () => {
    const qs: OrderedQuestion[] = [{ id: "a", question: "Tell me about yourself." }];
    const r = mapTranscriptToQuestions(qs, []);
    expect(r.mapped).toHaveLength(1);
    expect(r.mapped[0].answer).toBe("");
    expect(r.unansweredQuestionIds).toEqual(["a"]);
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
  });
});
