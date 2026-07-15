import { NextRequest, NextResponse } from "next/server";
import { respondToBehavioural } from "@/lib/behavioural/runner";
import { mockAnswerBank } from "@/lib/__mocks__/fixtures";
import { loadSession, saveSession } from "@/lib/voice/session-store";
import type { BehaviouralVoiceSession } from "@/lib/voice/types";
import {
  MAX_ANSWER_LENGTH,
  authorizeVapi,
  extractToolCalls,
  findToolCall,
  vapiEnvelope,
} from "@/lib/voice/vapi";

// POST /api/vapi/behavioural — Vapi tool webhook for the behavioural interview.
// Locates the `submit_behavioural_answer` tool call, resolves the current
// question via the stored questionIndex, scores it with the existing
// respondToBehavioural implementation, advances the cursor, and returns the Vapi
// results envelope (result is a JSON string of the normalized shape below).
const TOOL_NAME = "submit_behavioural_answer";

export async function POST(req: NextRequest) {
  const unauthorized = authorizeVapi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const call = findToolCall(extractToolCalls(body), TOOL_NAME);
  if (!call) {
    return NextResponse.json({ error: "tool_call_not_found" }, { status: 400 });
  }

  const sessionId =
    typeof call.parameters.sessionId === "string" ? call.parameters.sessionId : "";
  const answer = typeof call.parameters.answer === "string" ? call.parameters.answer : "";

  if (!sessionId) {
    return vapiEnvelope(TOOL_NAME, call.id, {
      complete: false,
      error: "missing_session_id",
      spokenText: "I lost track of this session. Let's restart the interview.",
    });
  }
  if (!answer || answer.length > MAX_ANSWER_LENGTH) {
    return vapiEnvelope(TOOL_NAME, call.id, {
      complete: false,
      error: "invalid_answer",
      spokenText: "I didn't catch a valid answer there — could you say that again?",
    });
  }

  const record = await loadSession(sessionId);
  if (!record || record.module !== "behavioural") {
    return vapiEnvelope(TOOL_NAME, call.id, {
      complete: true,
      nextQuestion: null,
      score: null,
      error: "session_not_found",
      spokenText: "I'm sorry, this interview session has expired.",
    });
  }

  const current = record.questions[record.questionIndex];
  if (!current) {
    // Already past the last question — nothing left to score.
    return vapiEnvelope(TOOL_NAME, call.id, {
      complete: true,
      nextQuestion: null,
      questionNumber: record.questions.length,
      score: null,
      spokenText: "That completes the behavioural interview. Thank you.",
    });
  }

  // Pass the current question ID and the exact answer into the existing scorer.
  const turn = await respondToBehavioural(
    record.session,
    current.id,
    answer,
    mockAnswerBank(),
  );

  const nextIndex = record.questionIndex + 1;
  const nextQuestion = record.questions[nextIndex] ?? null;
  const complete = nextQuestion == null;

  const updated: BehaviouralVoiceSession = {
    ...record,
    session: turn.session,
    questionIndex: nextIndex,
    updatedAt: new Date().toISOString(),
  };
  await saveSession(sessionId, updated);

  const spokenText = complete
    ? "Thank you. That was the final question — that completes the behavioural interview."
    : nextQuestion.question;

  return vapiEnvelope(TOOL_NAME, call.id, {
    spokenText,
    nextQuestion: nextQuestion ? { id: nextQuestion.id, question: nextQuestion.question } : null,
    questionNumber: complete ? record.questions.length : nextIndex + 1,
    complete,
    score: turn.score,
  });
}
