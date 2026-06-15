import { describe, it, expect } from "vitest";
import {
  respondToBehavioural,
  startBehavioural,
  summarizeBehavioural,
} from "@/lib/behavioural/runner";
import { MOCK_QUESTIONS, MOCK_JD_TEXT, mockAnswerBank } from "@/lib/__mocks__/fixtures";

const bank = mockAnswerBank();

const STRONG =
  "During my final-year consulting project, our team's churn model was unstable before the deadline. As team lead, I was responsible for getting us back on track. I organized a 45-minute reset, reassigned work by strength, and I rebuilt the model with a simpler logistic regression baseline using Python. As a result, we delivered on time and found three churn drivers explaining 62% of at-risk accounts.";
const WEAK = "We had a disagreement but it sorted itself out in the end.";

describe("behavioural runner (mock session)", () => {
  it("starts with a JD-grounded 'why this company' question and a fresh session", () => {
    const res = startBehavioural({ questionBank: MOCK_QUESTIONS, jdText: MOCK_JD_TEXT });
    expect(res.jd?.company).toBe("Revature");

    const why = res.questions.find((q) => q.id === "why_this_company");
    expect(why?.question).toContain("Revature");
    expect(res.session.questions_asked?.length).toBe(MOCK_QUESTIONS.length);
    expect(res.session.scores).toEqual({});
  });

  it("retrieves a matched prepared answer and records the score on the session", async () => {
    const start = startBehavioural({ questionBank: MOCK_QUESTIONS, jdText: MOCK_JD_TEXT });
    const turn = await respondToBehavioural(start.session, "leadership", STRONG, bank);

    expect(turn.matched_answer).not.toBeNull();
    expect(turn.match_score).not.toBeNull();
    expect(turn.score.overall).toBeGreaterThan(1);
    expect(turn.session.scores?.["leadership"]).toBeTruthy();
  });

  it("produces varied scores across answers and aggregates a session summary", async () => {
    let session = startBehavioural({ questionBank: MOCK_QUESTIONS, jdText: MOCK_JD_TEXT }).session;
    const t1 = await respondToBehavioural(session, "leadership", STRONG, bank);
    session = t1.session;
    const t2 = await respondToBehavioural(session, "conflict", WEAK, bank);
    session = t2.session;

    expect(new Set([t1.score.overall, t2.score.overall]).size).toBeGreaterThanOrEqual(2);

    const summary = summarizeBehavioural(session);
    expect(summary.answered).toBe(2);
    expect(summary.overall).toBeGreaterThanOrEqual(1);
    expect(summary.overall).toBeLessThanOrEqual(5);
    expect(summary.dimension_averages.length).toBeGreaterThan(0);
    expect(summary.session.feedback).not.toBeNull();
  });

  it("degrades gracefully with an empty answer bank (no match, still scores)", async () => {
    const start = startBehavioural({ questionBank: MOCK_QUESTIONS, jdText: MOCK_JD_TEXT });
    const turn = await respondToBehavioural(start.session, "leadership", STRONG, []);

    expect(turn.matched_answer).toBeNull();
    expect(turn.match_score).toBeNull();
    expect(turn.score.overall).toBeGreaterThanOrEqual(1);
    const dims = turn.score.dimension_scores.map((d) => d.dimension);
    expect(dims).not.toContain("Key-point coverage");
  });
});
