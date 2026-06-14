import { NextRequest, NextResponse } from "next/server";
import {
  MOCK_QUESTIONS,
  mockAnswerBank,
  mockBehaviouralScore,
} from "@/lib/__mocks__/fixtures";
import { retrieveAnswer } from "@/lib/rag";
import { useMocks } from "@/lib/config";

// POST /api/behavioural
//   { action: "questions", company? }            -> question list (company filled in)
//   { action: "score", questionId, answer }      -> score + RAG-matched prepared answer
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action: string = body.action ?? "questions";

  if (action === "questions") {
    const company: string = body.company || "this company";
    const questions = MOCK_QUESTIONS.map((q) => ({
      ...q,
      question: q.question.replace("{{company}}", company),
    }));
    return NextResponse.json({ questions });
  }

  // action === "score"
  const answer: string = body.answer ?? "";
  const questionId: string = body.questionId ?? "";
  const bank = mockAnswerBank();
  const matches = await retrieveAnswer(answer || questionId, bank, 1);
  const top = matches[0];

  return NextResponse.json({
    mock: useMocks(),
    score: mockBehaviouralScore,
    matched_answer: top ? { id: top.item.id, question: top.item.question } : null,
    match_score: top ? Number(top.score.toFixed(3)) : null,
  });
}
