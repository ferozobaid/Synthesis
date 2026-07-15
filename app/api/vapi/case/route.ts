import { NextRequest, NextResponse } from "next/server";
import { respondToCase } from "@/lib/fsm/case-runner";
import { mockCase } from "@/lib/__mocks__/fixtures";
import { loadSession, saveSession } from "@/lib/voice/session-store";
import type { CaseVoiceSession } from "@/lib/voice/types";
import type { CaseAction } from "@/lib/types";
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

// FSM action → UI intent hint for the client. The raw FSM action names never
// surface to the candidate (mirrors app/case/page.tsx's ACTION_LABEL policy).
const UI_ACTION: Record<CaseAction, string> = {
  advance: "advance_phase",
  probe: "probe",
  redirect: "redirect",
  hint: "show_hint",
  reveal: "reveal_exhibit",
};

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

  const action = turn.interviewer.action;
  const exhibit = turn.interviewer.exhibit
    ? {
        id: turn.interviewer.exhibit.id,
        title: turn.interviewer.exhibit.title,
        synthesized: turn.interviewer.exhibit.synthesized,
        insights: turn.interviewer.exhibit.insights ?? [],
        data: turn.interviewer.exhibit.data,
      }
    : null;

  return vapiEnvelope(TOOL_NAME, call.id, {
    spokenText: turn.interviewer.text,
    phase: turn.stage,
    action,
    complete: turn.complete,
    uiAction: turn.complete ? "complete" : (UI_ACTION[action] ?? "none"),
    exhibit,
    score: turn.score,
  });
}
