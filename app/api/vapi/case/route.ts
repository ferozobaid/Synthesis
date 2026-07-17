import { NextRequest, NextResponse } from "next/server";
import { mockCase } from "@/lib/__mocks__/fixtures";
import { respondToCase } from "@/lib/fsm/case-runner";
import {
  acquireLock,
  loadSession,
  releaseLock,
  saveSession,
} from "@/lib/voice/session-store";
import type { CaseVoiceSession, CaseVoiceToolResponse } from "@/lib/voice/types";
import {
  MAX_ANSWER_LENGTH,
  authorizeVapi,
  extractToolCalls,
  findToolCall,
  vapiEnvelope,
} from "@/lib/voice/vapi";
import { CASE_STATES } from "@/lib/types";
import type { CaseAction, CaseScore, CaseSessionState, CaseState } from "@/lib/types";

export const maxDuration = 300;

const TOOL_NAME = "submit_case_answer";
const LOCK_LEASE_SECONDS = 60;
const MAX_INVALID_RETRIES = 2;
const CACHE_LIMIT = 50;

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function resolveCallId(body: unknown): string | null {
  const m = (body as any)?.message;
  return firstString(m?.call?.id, m?.artifact?.call?.id, m?.callId);
}

function stageIndex(stage: CaseState | null): number {
  return stage ? CASE_STATES.indexOf(stage) : -1;
}

function cacheKey(callId: string, toolCallId: string): string {
  return `${callId}:${toolCallId}`;
}

function cacheWith(
  prior: Record<string, CaseVoiceToolResponse> | undefined,
  key: string,
  result: CaseVoiceToolResponse,
): Record<string, CaseVoiceToolResponse> {
  const entries = Object.entries({ ...(prior ?? {}), [key]: result });
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - CACHE_LIMIT)));
}

function cached(result: CaseVoiceToolResponse): CaseVoiceToolResponse {
  return { ...result, duplicate: true };
}

function retryResponse(
  session: CaseSessionState,
  turnSeq: number,
  score: CaseScore | null,
  retryCount: number,
): CaseVoiceToolResponse {
  const capped = retryCount >= MAX_INVALID_RETRIES;
  return {
    spokenText: capped
      ? "I still couldn't capture a valid answer. Please end the voice interview and continue in text mode."
      : "I didn't catch a valid answer. Please give your response again.",
    stage: session.fsm_state,
    stageIndex: stageIndex(session.fsm_state),
    action: "retry",
    exhibit: null,
    complete: session.complete,
    score,
    turnSeq,
    error: "invalid_answer",
    retryable: !capped,
    retryCount,
    maxRetries: MAX_INVALID_RETRIES,
  };
}

function terminalResponse(
  session: CaseSessionState,
  turnSeq: number,
  score: CaseScore | null,
): CaseVoiceToolResponse {
  return {
    spokenText: "That completes the case interview. Thank you.",
    stage: session.fsm_state,
    stageIndex: stageIndex(session.fsm_state),
    action: null,
    exhibit: null,
    complete: true,
    score,
    turnSeq,
  };
}

function errorResponse(
  error: string,
  spokenText: string,
  opts: Partial<CaseVoiceToolResponse> = {},
): CaseVoiceToolResponse {
  return {
    spokenText,
    stage: opts.stage ?? null,
    stageIndex: opts.stageIndex ?? stageIndex(opts.stage ?? null),
    action: opts.action ?? null,
    exhibit: opts.exhibit ?? null,
    complete: opts.complete ?? false,
    score: opts.score ?? null,
    turnSeq: opts.turnSeq ?? 0,
    error,
    retryable: false,
  };
}

function caseResult(
  session: CaseSessionState,
  turnSeq: number,
  action: CaseAction,
  spokenText: string,
  exhibit: CaseVoiceToolResponse["exhibit"],
  score: CaseScore | null,
): CaseVoiceToolResponse {
  return {
    spokenText,
    stage: session.fsm_state,
    stageIndex: stageIndex(session.fsm_state),
    action,
    exhibit,
    complete: session.complete || session.fsm_state === "scoring",
    score,
    turnSeq,
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

  const sessionId = typeof call.parameters.sessionId === "string" ? call.parameters.sessionId.trim() : "";
  const callId = resolveCallId(body);
  const answer = typeof call.parameters.answer === "string" ? call.parameters.answer.trim() : "";

  if (!sessionId) {
    return vapiEnvelope(
      TOOL_NAME,
      call.id,
      errorResponse("missing_session_id", "I lost track of this case session. Please restart the interview."),
    );
  }
  if (!callId) {
    return vapiEnvelope(
      TOOL_NAME,
      call.id,
      errorResponse("missing_call_id", "I can't safely process this turn. Please restart the interview."),
    );
  }

  const initial = await loadSession(sessionId).catch(() => null);
  if (!initial || initial.module !== "case") {
    return vapiEnvelope(
      TOOL_NAME,
      call.id,
      errorResponse("session_not_found", "I'm sorry, this case session has expired.", { complete: true }),
    );
  }

  const key = cacheKey(callId, call.id);
  const initialCached = initial.processedToolCalls?.[key];
  if (initialCached) return vapiEnvelope(TOOL_NAME, call.id, cached(initialCached));

  if (initial.callId && initial.callId !== callId) {
    return vapiEnvelope(
      TOOL_NAME,
      call.id,
      errorResponse("call_mismatch", "This case session is already attached to another call. Please restart the interview.", {
        stage: initial.session.fsm_state,
        stageIndex: stageIndex(initial.session.fsm_state),
        complete: initial.session.complete,
        score: initial.score ?? null,
        turnSeq: initial.turnSeq ?? 0,
      }),
    );
  }

  const lockKey = `lock:case:${sessionId}`;
  const lockToken = await acquireLock(lockKey, LOCK_LEASE_SECONDS).catch(() => null);
  if (!lockToken) {
    return vapiEnvelope(
      TOOL_NAME,
      call.id,
      errorResponse("turn_in_progress", "One moment while I process your last answer.", {
        stage: initial.session.fsm_state,
        stageIndex: stageIndex(initial.session.fsm_state),
        complete: initial.session.complete,
        score: initial.score ?? null,
        turnSeq: initial.turnSeq ?? 0,
      }),
    );
  }

  try {
    const current = await loadSession(sessionId);
    if (!current || current.module !== "case") {
      return vapiEnvelope(
        TOOL_NAME,
        call.id,
        errorResponse("session_not_found", "I'm sorry, this case session has expired.", { complete: true }),
      );
    }

    const already = current.processedToolCalls?.[key];
    if (already) return vapiEnvelope(TOOL_NAME, call.id, cached(already));

    if (current.callId && current.callId !== callId) {
      return vapiEnvelope(
        TOOL_NAME,
        call.id,
        errorResponse("call_mismatch", "This case session is already attached to another call. Please restart the interview.", {
          stage: current.session.fsm_state,
          stageIndex: stageIndex(current.session.fsm_state),
          complete: current.session.complete,
          score: current.score ?? null,
          turnSeq: current.turnSeq ?? 0,
        }),
      );
    }

    if (!answer || answer.length > MAX_ANSWER_LENGTH) {
      const retryCount = Math.min((current.invalidRetries ?? 0) + 1, MAX_INVALID_RETRIES);
      const result = retryResponse(current.session, current.turnSeq ?? 0, current.score ?? null, retryCount);
      const updated: CaseVoiceSession = {
        ...current,
        invalidRetries: retryCount,
        processedToolCalls: cacheWith(current.processedToolCalls, key, result),
        updatedAt: new Date().toISOString(),
      };
      await saveSession(sessionId, updated);
      return vapiEnvelope(TOOL_NAME, call.id, result);
    }

    const c = mockCase(current.caseId);
    if (!c || current.caseId !== "beautify") {
      return vapiEnvelope(
        TOOL_NAME,
        call.id,
        errorResponse("unsupported_case", "This case is not available in voice mode yet.", {
          stage: current.session.fsm_state,
          stageIndex: stageIndex(current.session.fsm_state),
          complete: current.session.complete,
          score: current.score ?? null,
          turnSeq: current.turnSeq ?? 0,
        }),
      );
    }

    if (current.session.complete || current.session.fsm_state === "scoring") {
      const result = terminalResponse(current.session, current.turnSeq ?? 0, current.score ?? null);
      const updated: CaseVoiceSession = {
        ...current,
        callId: current.callId ?? callId,
        processedToolCalls: cacheWith(current.processedToolCalls, key, result),
        updatedAt: new Date().toISOString(),
      };
      await saveSession(sessionId, updated);
      return vapiEnvelope(TOOL_NAME, call.id, result);
    }

    const turn = await respondToCase(c, current.session, answer);
    const turnSeq = (current.turnSeq ?? 0) + 1;
    const score = turn.score ?? current.score ?? null;
    const result = caseResult(
      turn.session,
      turnSeq,
      turn.interviewer.action,
      turn.interviewer.text,
      turn.interviewer.exhibit,
      score,
    );
    const updated: CaseVoiceSession = {
      ...current,
      session: turn.session,
      callId: current.callId ?? callId,
      turnSeq,
      score,
      invalidRetries: 0,
      processedToolCalls: cacheWith(current.processedToolCalls, key, result),
      updatedAt: new Date().toISOString(),
    };
    await saveSession(sessionId, updated);

    return vapiEnvelope(TOOL_NAME, call.id, result);
  } finally {
    await releaseLock(lockKey, lockToken).catch(() => {});
  }
}
