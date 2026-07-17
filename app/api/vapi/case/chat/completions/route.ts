import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mockCase } from "@/lib/__mocks__/fixtures";
import { respondToCase } from "@/lib/fsm/case-runner";
import {
  acquireLock,
  loadSession,
  releaseLock,
  saveSession,
} from "@/lib/voice/session-store";
import type {
  CaseVoiceModelResponse,
  CaseVoiceProjectedTurn,
  CaseVoiceSession,
} from "@/lib/voice/types";
import { authorizeVapi, MAX_ANSWER_LENGTH } from "@/lib/voice/vapi";

export const maxDuration = 300;

const LOCK_LEASE_SECONDS = 300;
const LOCK_WAIT_MILLISECONDS = 120_000;
const LOCK_POLL_MILLISECONDS = 100;
const CACHE_LIMIT = 50;
const MODEL_NAME = "synthesis-case-fsm";

interface OpenAIMessage {
  role?: unknown;
  content?: unknown;
}

interface OpenAIChatRequest {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  metadata?: unknown;
  call?: unknown;
  sessionId?: unknown;
  caseId?: unknown;
}

class CaseModelRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CaseModelRequestError";
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = part as { type?: unknown; text?: unknown };
      return (value.type === "text" || value.type === "input_text") && typeof value.text === "string"
        ? value.text
        : "";
    })
    .join("");
}

function normalizeMessages(value: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) {
    throw new CaseModelRequestError("missing_messages", 400, "messages must be a non-empty array");
  }
  const messages = value.map((message) => {
    const item = message as OpenAIMessage | null;
    return {
      role: typeof item?.role === "string" ? item.role : "",
      content: textContent(item?.content),
    };
  });
  if (messages.length === 0) {
    throw new CaseModelRequestError("missing_messages", 400, "messages must be a non-empty array");
  }
  return messages;
}

function latestCandidateText(messages: Array<{ role: string; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content.trim();
  }
  return "";
}

function requestCacheKey(
  sessionId: string,
  callId: string,
  messages: Array<{ role: string; content: string }>,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ sessionId, callId, messages }))
    .digest("hex");
  return `${callId}:${digest}`;
}

function cacheWith(
  prior: Record<string, CaseVoiceModelResponse> | undefined,
  key: string,
  result: CaseVoiceModelResponse,
): Record<string, CaseVoiceModelResponse> {
  const entries = Object.entries({ ...(prior ?? {}), [key]: result });
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - CACHE_LIMIT)));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireTurnLock(
  sessionId: string,
  callId: string,
  cacheKey: string,
): Promise<{ lockKey: string; lockToken: string } | { cached: CaseVoiceModelResponse }> {
  const lockKey = `lock:case:${sessionId}`;
  const deadline = Date.now() + LOCK_WAIT_MILLISECONDS;

  while (Date.now() < deadline) {
    const lockToken = await acquireLock(lockKey, LOCK_LEASE_SECONDS);
    if (lockToken) return { lockKey, lockToken };

    const current = await loadSession(sessionId);
    if (!current || current.module !== "case") {
      throw new CaseModelRequestError("session_not_found", 404, "Case voice session not found or expired");
    }
    const cached = current.processedModelRequests?.[cacheKey];
    if (cached) return { cached };
    if (current.callId && current.callId !== callId) {
      throw new CaseModelRequestError("call_mismatch", 409, "Case voice session is bound to another call");
    }

    await delay(LOCK_POLL_MILLISECONDS);
  }

  throw new CaseModelRequestError("turn_in_progress", 409, "The candidate turn is still being processed");
}

function openAIError(error: CaseModelRequestError): NextResponse {
  return NextResponse.json(
    {
      error: {
        message: error.message,
        type: "invalid_request_error",
        code: error.code,
      },
    },
    { status: error.status },
  );
}

function completionId(cacheKey: string): string {
  const digest = cacheKey.slice(cacheKey.lastIndexOf(":") + 1, cacheKey.length);
  return `chatcmpl-case-${digest.slice(0, 24)}`;
}

function openAIResponse(
  result: CaseVoiceModelResponse,
  cacheKey: string,
  requestedModel: unknown,
  stream: boolean,
): Response {
  const id = completionId(cacheKey);
  const model = typeof requestedModel === "string" && requestedModel.trim()
    ? requestedModel.trim()
    : MODEL_NAME;
  const created = Math.floor(Date.now() / 1000);

  if (!stream) {
    return NextResponse.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.spokenText },
          finish_reason: "stop",
        },
      ],
    });
  }

  const contentChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: result.spokenText },
        finish_reason: null,
      },
    ],
  };
  const stopChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  const body = `data: ${JSON.stringify(contentChunk)}\n\ndata: ${JSON.stringify(stopChunk)}\n\ndata: [DONE]\n\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function processTurn(
  body: OpenAIChatRequest,
): Promise<{ result: CaseVoiceModelResponse; cacheKey: string }> {
  const metadata = body.metadata as Record<string, unknown> | null;
  const call = body.call as Record<string, unknown> | null;
  const sessionId = firstString(metadata?.sessionId, body.sessionId);
  const callId = firstString(call?.id, metadata?.callId);
  const requestedCaseId = firstString(metadata?.caseId, body.caseId);
  const messages = normalizeMessages(body.messages);
  const answer = latestCandidateText(messages);

  if (!sessionId) {
    throw new CaseModelRequestError("missing_session_id", 400, "sessionId metadata is required");
  }
  if (!callId) {
    throw new CaseModelRequestError("missing_call_id", 400, "call.id metadata is required");
  }
  if (requestedCaseId && requestedCaseId !== "beautify") {
    throw new CaseModelRequestError("unsupported_case", 400, "Only the Beautify case supports voice");
  }
  if (!answer) {
    throw new CaseModelRequestError("missing_answer", 400, "The latest candidate turn is empty");
  }
  if (answer.length > MAX_ANSWER_LENGTH) {
    throw new CaseModelRequestError("answer_too_long", 400, "The latest candidate turn is too long");
  }

  const cacheKey = requestCacheKey(sessionId, callId, messages);
  const initial = await loadSession(sessionId).catch(() => null);
  if (!initial || initial.module !== "case") {
    throw new CaseModelRequestError("session_not_found", 404, "Case voice session not found or expired");
  }
  const initialCached = initial.processedModelRequests?.[cacheKey];
  if (initialCached) return { result: initialCached, cacheKey };
  if (initial.callId && initial.callId !== callId) {
    throw new CaseModelRequestError("call_mismatch", 409, "Case voice session is bound to another call");
  }

  const claim = await acquireTurnLock(sessionId, callId, cacheKey);
  if ("cached" in claim) return { result: claim.cached, cacheKey };
  const { lockKey, lockToken } = claim;

  try {
    const current = await loadSession(sessionId);
    if (!current || current.module !== "case") {
      throw new CaseModelRequestError("session_not_found", 404, "Case voice session not found or expired");
    }
    const cached = current.processedModelRequests?.[cacheKey];
    if (cached) return { result: cached, cacheKey };
    if (current.callId && current.callId !== callId) {
      throw new CaseModelRequestError("call_mismatch", 409, "Case voice session is bound to another call");
    }
    if (current.caseId !== "beautify") {
      throw new CaseModelRequestError("unsupported_case", 400, "Only the Beautify case supports voice");
    }
    if (current.session.complete || current.session.fsm_state === "scoring") {
      throw new CaseModelRequestError("case_complete", 409, "The Case interview is already complete");
    }

    const c = mockCase(current.caseId);
    if (!c) {
      throw new CaseModelRequestError("case_not_found", 404, "The Case content is unavailable");
    }

    const turn = await respondToCase(c, current.session, answer);
    const turnSeq = (current.turnSeq ?? 0) + 1;
    const score = turn.score ?? current.score ?? null;
    const timestamp = new Date().toISOString();
    const result: CaseVoiceModelResponse = {
      spokenText: turn.interviewer.text,
      stage: turn.session.fsm_state,
      action: turn.interviewer.action,
      exhibit: turn.interviewer.exhibit,
      complete: turn.session.complete || turn.session.fsm_state === "scoring",
      score,
      turnSeq,
    };
    const projectedTurn: CaseVoiceProjectedTurn = {
      turnSeq,
      candidateText: answer,
      interviewerText: result.spokenText,
      stage: result.stage,
      action: result.action,
      exhibit: result.exhibit,
      timestamp,
    };
    const updated: CaseVoiceSession = {
      ...current,
      session: turn.session,
      callId: current.callId ?? callId,
      turnSeq,
      score,
      invalidRetries: 0,
      processedModelRequests: cacheWith(current.processedModelRequests, cacheKey, result),
      projectedTurns: [...(current.projectedTurns ?? []), projectedTurn],
      updatedAt: timestamp,
    };
    await saveSession(sessionId, updated);

    return { result, cacheKey };
  } finally {
    await releaseLock(lockKey, lockToken).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = authorizeVapi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null) as OpenAIChatRequest | null;
  if (!body || typeof body !== "object") {
    return openAIError(new CaseModelRequestError("invalid_json", 400, "A JSON request body is required"));
  }

  try {
    const { result, cacheKey } = await processTurn(body);
    return openAIResponse(result, cacheKey, body.model, body.stream !== false);
  } catch (error) {
    if (error instanceof CaseModelRequestError) return openAIError(error);
    console.error("[case-custom-llm] turn failed", error);
    return openAIError(new CaseModelRequestError("internal_error", 500, "The Case turn could not be processed"));
  }
}
