import { NextRequest, NextResponse } from "next/server";
import {
  MOCK_JD_TEXT,
  MOCK_QUESTIONS,
  MOCK_USER_ID,
  mockAnswerBank,
} from "@/lib/__mocks__/fixtures";
import { useMocks } from "@/lib/config";
import {
  respondToBehavioural,
  startBehavioural,
  summarizeBehavioural,
} from "@/lib/behavioural/runner";
import type { BehaviouralSession } from "@/lib/types";

// POST /api/behavioural
//   { action: "start", jdText? }                       -> session + questions (JD-filled)
//   { action: "respond", session, questionId, answer } -> score + matched prepared answer
//   { action: "summary", session }                     -> aggregate scores + feedback
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action: string = body.action ?? "start";

  if (action === "start") {
    // In mock/demo mode, fall back to a sample JD so "why this company" is grounded
    // without the user pasting one.
    const jdText: string =
      body.jdText && body.jdText.trim() ? body.jdText : useMocks() ? MOCK_JD_TEXT : "";
    return NextResponse.json(
      startBehavioural({ questionBank: MOCK_QUESTIONS, jdText, userId: MOCK_USER_ID }),
    );
  }

  if (action === "summary") {
    const session = body.session as BehaviouralSession | undefined;
    if (!session) return NextResponse.json({ error: "session required" }, { status: 400 });
    return NextResponse.json(summarizeBehavioural(session));
  }

  // action === "respond"
  const session = body.session as BehaviouralSession | undefined;
  if (!session) return NextResponse.json({ error: "session required" }, { status: 400 });
  const questionId: string = body.questionId ?? "";
  const answer: string = body.answer ?? "";
  return NextResponse.json(
    await respondToBehavioural(session, questionId, answer, mockAnswerBank()),
  );
}
