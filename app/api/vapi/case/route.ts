import { NextRequest, NextResponse } from "next/server";
import { respondToCase } from "@/lib/fsm/case-runner";
import { mockCase } from "@/lib/__mocks__/fixtures";
import { loadSession, saveSession } from "@/lib/voice/session-store";
import type { CaseVoiceSession } from "@/lib/voice/types";
import type { CaseExhibit } from "@/lib/types";
import {
  MAX_ANSWER_LENGTH,
  authorizeVapi,
  extractToolCalls,
  findToolCall,
  vapiEnvelope,
} from "@/lib/voice/vapi";

// POST /api/vapi/case — Vapi tool webhook for the case interview.
// Locates the `advance_case_interview` tool call, replays it through the existing
// respondToCase FSM orchestration, persists the updated session, and returns the
// Vapi results envelope (result is a JSON string of the normalized shape below).
const TOOL_NAME = "advance_case_interview";

/**
 * Reduce a just-revealed exhibit to exactly the fields the existing Case UI
 * (components/ui/ExhibitCard.tsx) already shows the candidate: title, insights,
 * and data. `id` is a non-sensitive correlation handle. Internal authoring fields
 * (note, stage, synthesized) and any not-yet-revealed exhibit are never included.
 */
function toPublicExhibit(ex: CaseExhibit) {
  return {
    id: ex.id,
    title: ex.title,
    insights: ex.insights ?? [],
    data: ex.data,
  };
}

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
      spokenText: "I lost track of this session. Let's restart the case.",
    });
  }
  if (answer.length > MAX_ANSWER_LENGTH) {
    return vapiEnvelope(TOOL_NAME, call.id, {
      complete: false,
      error: "invalid_answer",
      spokenText: "That response was longer than I can take in — could you summarize it?",
    });
  }

  const record = await loadSession(sessionId);
  if (!record || record.module !== "case") {
    return vapiEnvelope(TOOL_NAME, call.id, {
      complete: true,
      error: "session_not_found",
      spokenText: "I'm sorry, this case session has expired.",
    });
  }

  const c = mockCase(record.caseId);
  if (!c) {
    return vapiEnvelope(TOOL_NAME, call.id, {
      complete: true,
      error: "case_not_found",
      spokenText: "I couldn't load this case. Let's start a new one.",
    });
  }

  // Reuse the existing FSM orchestration unchanged.
  const turn = await respondToCase(c, record.session, answer);

  const updated: CaseVoiceSession = {
    ...record,
    session: turn.session,
    updatedAt: new Date().toISOString(),
  };
  await saveSession(sessionId, updated);

  // Return ONLY the candidate-visible surface. Evaluator reasoning
  // (turn.evaluation), FSM context (turn.decision / turn.context) and the stored
  // session JSON are never included. The final score is exposed only at
  // completion (it is the candidate-facing report rendered in the Case UI).
  return vapiEnvelope(TOOL_NAME, call.id, {
    spokenText: turn.interviewer.text,
    phase: turn.stage,
    action: turn.interviewer.action,
    complete: turn.complete,
    exhibit: turn.interviewer.exhibit ? toPublicExhibit(turn.interviewer.exhibit) : null,
    score: turn.complete ? turn.score : null,
  });
}
