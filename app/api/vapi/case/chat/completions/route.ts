import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mockCase } from "@/lib/__mocks__/fixtures";
import {
  respondToCase,
  transitionCaseSession,
  type CaseRunnerTimings,
} from "@/lib/fsm/case-runner";
import {
  assessCaseFramework,
  collectCaseFrameworkEvidence,
  frameworkProbeObjectiveAnswered,
} from "@/lib/fsm/case-framework";
import {
  CASE_ALREADY_READY_RESPONSE,
  CASE_NOT_READY_RESPONSE,
  CASE_READINESS_PROMPT,
  caseConversationText,
  caseFrameworkFrustrationText,
  caseMetaConversationText,
  caseOpeningAfterReadiness,
} from "@/lib/voice/case-conversation";
import {
  caseIntentUsesEvaluator,
  routeCaseCandidateTurn,
  type CaseCandidateIntent,
} from "@/lib/voice/case-intent";
import {
  addCaseTurnDuration,
  caseServerTiming,
  logCaseLatency,
  newCaseTurnTimings,
  type CaseTurnTimings,
} from "@/lib/voice/case-latency";
import {
  candidateRevisionRelation,
  isCandidateRevision,
  normalizeCandidateText,
  type CandidateRevisionRelation,
} from "@/lib/voice/case-turn-sync";
import {
  acquireLock,
  loadSession,
  releaseLock,
  saveSession,
} from "@/lib/voice/session-store";
import type {
  CaseVoiceModelResponse,
  CaseVoicePendingCandidate,
  CaseVoiceProjectedTurn,
  CaseVoiceSession,
} from "@/lib/voice/types";
import type { CaseState } from "@/lib/types";
import { authorizeVapi, MAX_ANSWER_LENGTH } from "@/lib/voice/vapi";

export const maxDuration = 300;

const LOCK_LEASE_SECONDS = 300;
const LOCK_WAIT_MILLISECONDS = 120_000;
const LOCK_POLL_MILLISECONDS = 100;
const PENDING_LOCK_WAIT_MILLISECONDS = 10_000;
const PENDING_STALE_MILLISECONDS = 30_000;
const MAX_REVISION_ELAPSED_MILLISECONDS = 10_000;
const DEFAULT_REVISION_WINDOW_MILLISECONDS = 750;
const CACHE_LIMIT = 50;
const MODEL_NAME = "synthesis-case-fsm";

interface OpenAIMessage {
  id?: unknown;
  role?: unknown;
  content?: unknown;
}

interface OpenAIChatRequest {
  id?: unknown;
  requestId?: unknown;
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  metadata?: unknown;
  call?: unknown;
  sessionId?: unknown;
  caseId?: unknown;
}

interface NormalizedMessage {
  id: string | null;
  role: string;
  content: string;
}

interface CandidateRequest {
  sessionId: string;
  callId: string;
  requestedCaseId: string | null;
  messages: NormalizedMessage[];
  answer: string;
  messageId: string | null;
  requestId: string | null;
  cacheKey: string;
}

type TurnOutcome = "received" | "replaced" | "ignored" | "deduplicated" | "processed";

function hasSessionMetadata(body: OpenAIChatRequest | null): boolean {
  const metadata = body?.metadata as Record<string, unknown> | null;
  return typeof metadata?.sessionId === "string" && metadata.sessionId.trim().length > 0;
}

function logRequestDiagnostic(
  req: NextRequest,
  body: OpenAIChatRequest | null,
  statusCode: number,
): void {
  if (process.env.VAPI_CASE_AUTH_DEBUG !== "true") return;
  const authorization = req.headers.get("authorization")?.trim() ?? "";
  const authenticationScheme = authorization.split(/\s+/, 1)[0] || "none";
  console.info("[case-custom-llm] request", {
    requestReceived: true,
    authorizationHeader: authorization ? "present" : "absent",
    authenticationScheme,
    metadataSessionId: hasSessionMetadata(body) ? "present" : "absent",
    statusCode,
  });
}

function revisionWindowMilliseconds(): number {
  const configured = Number(process.env.CASE_VOICE_REVISION_WINDOW_MS);
  return Number.isFinite(configured) && configured >= 0 && configured <= 5_000
    ? configured
    : DEFAULT_REVISION_WINDOW_MILLISECONDS;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function logTurnDiagnostic(
  candidate: CandidateRequest,
  stage: string,
  outcome: TurnOutcome,
  relation: CandidateRevisionRelation = "none",
  previousPending: CaseVoicePendingCandidate | null = null,
): void {
  if (process.env.VAPI_CASE_TURN_DEBUG !== "true") return;
  console.info("[case-custom-llm] turn", {
    requestId: candidate.requestId ?? "absent",
    callId: candidate.callId,
    messageId: candidate.messageId ?? "absent",
    messageCount: candidate.messages.length,
    latestUserMessageLength: candidate.answer.length,
    latestUserMessageHash: shortHash(candidate.answer),
    previousPendingLength: previousPending?.candidateText.length ?? 0,
    previousPendingHash: previousPending ? shortHash(previousPending.candidateText) : "absent",
    revisionRelation: relation,
    stage,
    timestamp: new Date().toISOString(),
    outcome,
  });
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

function normalizeMessages(value: unknown): NormalizedMessage[] {
  if (!Array.isArray(value)) {
    throw new CaseModelRequestError("missing_messages", 400, "messages must be a non-empty array");
  }
  const messages = value.map((message) => {
    const item = message as OpenAIMessage | null;
    return {
      id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : null,
      role: typeof item?.role === "string" ? item.role : "",
      content: textContent(item?.content),
    };
  });
  if (messages.length === 0) {
    throw new CaseModelRequestError("missing_messages", 400, "messages must be a non-empty array");
  }
  return messages;
}

function latestCandidateMessage(messages: NormalizedMessage[]): NormalizedMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

function requestCacheKey(
  sessionId: string,
  callId: string,
  messages: NormalizedMessage[],
): string {
  const materialMessages = messages.filter(
    ({ role, content }) => role !== "assistant" || content.trim().length > 0,
  );
  const digest = createHash("sha256")
    .update(JSON.stringify({
      sessionId,
      callId,
      messages: materialMessages.map(({ role, content }) => ({ role, content })),
    }))
    .digest("hex");
  return `${callId}:${digest}`;
}

function parseCandidateRequest(
  req: NextRequest,
  body: OpenAIChatRequest,
): CandidateRequest {
  const metadata = body.metadata as Record<string, unknown> | null;
  const call = body.call as Record<string, unknown> | null;
  const sessionId = firstString(metadata?.sessionId, body.sessionId);
  const callId = firstString(call?.id, metadata?.callId);
  const requestedCaseId = firstString(metadata?.caseId, body.caseId);
  const messages = normalizeMessages(body.messages);
  const latestCandidate = latestCandidateMessage(messages);
  const answer = latestCandidate?.content.trim() ?? "";

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

  return {
    sessionId,
    callId,
    requestedCaseId,
    messages,
    answer,
    messageId: latestCandidate?.id ?? null,
    requestId: firstString(
      req.headers.get("x-request-id"),
      req.headers.get("x-vapi-request-id"),
      body.requestId,
      body.id,
      req.headers.get("x-vercel-id"),
    ),
    cacheKey: requestCacheKey(sessionId, callId, messages),
  };
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

async function acquirePendingLock(sessionId: string): Promise<{ lockKey: string; lockToken: string }> {
  const lockKey = `lock:case-pending:${sessionId}`;
  const deadline = Date.now() + PENDING_LOCK_WAIT_MILLISECONDS;
  while (Date.now() < deadline) {
    const lockToken = await acquireLock(lockKey, 30);
    if (lockToken) return { lockKey, lockToken };
    await delay(LOCK_POLL_MILLISECONDS);
  }
  throw new CaseModelRequestError("turn_in_progress", 409, "The candidate turn is still being synchronized");
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
  timings: CaseTurnTimings,
): Response {
  const id = completionId(cacheKey);
  const model = typeof requestedModel === "string" && requestedModel.trim()
    ? requestedModel.trim()
    : MODEL_NAME;
  const created = Math.floor(Date.now() / 1000);

  if (!stream) {
    timings.firstSseChunkMs = Date.now() - timings.startedAt;
    return NextResponse.json(
      {
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
      },
      { headers: { "Server-Timing": caseServerTiming(timings) } },
    );
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
  timings.firstSseChunkMs = Date.now() - timings.startedAt;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Server-Timing": caseServerTiming(timings),
    },
  });
}

function assertCaseSession(
  current: CaseVoiceSession | null,
  candidate: CandidateRequest,
): asserts current is CaseVoiceSession {
  if (!current || current.module !== "case") {
    throw new CaseModelRequestError("session_not_found", 404, "Case voice session not found or expired");
  }
  if (current.callId && current.callId !== candidate.callId) {
    throw new CaseModelRequestError("call_mismatch", 409, "Case voice session is bound to another call");
  }
  if (current.caseId !== "beautify") {
    throw new CaseModelRequestError("unsupported_case", 400, "Only the Beautify case supports voice");
  }
  if (current.session.complete || current.session.fsm_state === "scoring") {
    throw new CaseModelRequestError("case_complete", 409, "The Case interview is already complete");
  }
}

function suppressedResult(current: CaseVoiceSession): CaseVoiceModelResponse {
  return {
    spokenText: "",
    stage: current.session.fsm_state,
    action: "suppressed",
    exhibit: null,
    complete: current.session.complete,
    score: current.score ?? null,
    turnSeq: current.turnSeq ?? 0,
    suppressed: true,
  };
}

function pendingCandidate(
  candidate: CandidateRequest,
  stage: CaseVoiceSession["session"]["fsm_state"],
  now: number,
): CaseVoicePendingCandidate {
  return {
    requestKey: candidate.cacheKey,
    requestId: candidate.requestId,
    messageId: candidate.messageId,
    callId: candidate.callId,
    stage,
    candidateText: candidate.answer,
    normalizedText: normalizeCandidateText(candidate.answer),
    messageCount: candidate.messages.length,
    receivedAt: now,
    updatedAt: now,
  };
}

async function registerPendingCandidate(
  candidate: CandidateRequest,
  timings: CaseTurnTimings,
): Promise<CaseVoiceModelResponse | null> {
  const deadline = Date.now() + LOCK_WAIT_MILLISECONDS;
  while (Date.now() < deadline) {
    const lockStartedAt = Date.now();
    const claim = await acquirePendingLock(candidate.sessionId);
    addCaseTurnDuration(timings, "redisLockMs", lockStartedAt);
    let waitForPrior = false;
    try {
      const current = await loadSession(candidate.sessionId) as CaseVoiceSession | null;
      assertCaseSession(current, candidate);
      const cached = current.processedModelRequests?.[candidate.cacheKey];
      if (cached) return cached;

      const existing = current.pendingCandidate ?? null;
      if (!existing) {
        const now = Date.now();
        await saveSession(candidate.sessionId, {
          ...current,
          callId: current.callId ?? candidate.callId,
          pendingCandidate: pendingCandidate(candidate, current.session.fsm_state, now),
          updatedAt: new Date(now).toISOString(),
        });
        return null;
      }
      if (existing.requestKey === candidate.cacheKey) return null;

      const relation = candidateRevisionRelation(
        existing.candidateText,
        candidate.answer,
        existing.messageId,
        candidate.messageId,
      );
      const now = Date.now();
      const sameTurnBoundary =
        existing.callId === candidate.callId &&
        existing.stage === current.session.fsm_state &&
        now - existing.updatedAt <= MAX_REVISION_ELAPSED_MILLISECONDS;
      const stale = now - existing.updatedAt > PENDING_STALE_MILLISECONDS;

      if ((sameTurnBoundary && isCandidateRevision(relation)) || stale) {
        const ignored = suppressedResult(current);
        await saveSession(candidate.sessionId, {
          ...current,
          callId: current.callId ?? candidate.callId,
          processedModelRequests: cacheWith(
            current.processedModelRequests,
            existing.requestKey,
            ignored,
          ),
          pendingCandidate: pendingCandidate(candidate, current.session.fsm_state, now),
          updatedAt: new Date(now).toISOString(),
        });
        logTurnDiagnostic(candidate, current.session.fsm_state, "replaced", relation, existing);
        return null;
      }

      waitForPrior = true;
    } finally {
      await releaseLock(claim.lockKey, claim.lockToken).catch(() => {});
    }

    if (waitForPrior) await delay(LOCK_POLL_MILLISECONDS);
  }
  throw new CaseModelRequestError("turn_in_progress", 409, "The prior candidate turn is still being processed");
}

interface CandidateEvaluation {
  result: CaseVoiceModelResponse;
  commit: (current: CaseVoiceSession) => CaseVoiceSession;
}

function currentInterviewerPrompt(current: CaseVoiceSession): string {
  const turns = current.projectedTurns ?? [];
  return turns.at(-1)?.interviewerText ?? current.openingText ?? CASE_READINESS_PROMPT;
}

function metaConversationEvaluation(
  current: CaseVoiceSession,
  intent: CaseCandidateIntent,
): CandidateEvaluation {
  const conversationStatus = intent === "thinking-pause-request"
    ? "paused"
    : intent === "readiness-confirmation"
      ? "active"
      : current.conversationStatus ?? "active";
  return {
    result: {
      spokenText: caseMetaConversationText(
        intent,
        current.session.fsm_state,
        currentInterviewerPrompt(current),
      ),
      stage: current.session.fsm_state,
      action: "conversation",
      exhibit: null,
      complete: false,
      score: current.score ?? null,
      turnSeq: current.turnSeq ?? 0,
    },
    commit: (latest) => ({ ...latest, conversationStatus }),
  };
}

function frustrationEvaluation(
  current: CaseVoiceSession,
  c: NonNullable<ReturnType<typeof mockCase>>,
): CandidateEvaluation {
  const objective = current.lastProbeObjective ?? null;
  const framework = current.session.fsm_state === "framework"
    ? assessCaseFramework(c, collectCaseFrameworkEvidence(current.session))
    : null;
  const advanced = Boolean(
    objective &&
      framework?.accepted &&
      frameworkProbeObjectiveAnswered(objective, framework),
  );
  const session = advanced
    ? transitionCaseSession(current.session, "analysis")
    : current.session;
  return {
    result: {
      spokenText: caseFrameworkFrustrationText(
        objective,
        advanced,
        current.session.fsm_state,
        currentInterviewerPrompt(current),
      ),
      stage: session.fsm_state,
      action: advanced ? "advance" : "conversation",
      exhibit: null,
      complete: false,
      score: current.score ?? null,
      turnSeq: current.turnSeq ?? 0,
    },
    commit: (latest) => {
      if (!advanced || latest.session.fsm_state !== "framework") {
        return { ...latest, conversationStatus: "active" };
      }
      const latestFramework = assessCaseFramework(
        c,
        collectCaseFrameworkEvidence(latest.session),
      );
      const latestObjective = latest.lastProbeObjective ?? null;
      if (
        !latestObjective ||
        !latestFramework.accepted ||
        !frameworkProbeObjectiveAnswered(latestObjective, latestFramework)
      ) {
        return { ...latest, conversationStatus: "active" };
      }
      return {
        ...latest,
        session: transitionCaseSession(latest.session, "analysis"),
        conversationStatus: "active",
        lastProbeObjective: null,
      };
    },
  };
}

function stageTransitionEvaluation(
  current: CaseVoiceSession,
  c: NonNullable<ReturnType<typeof mockCase>>,
  target: CaseState,
): CandidateEvaluation {
  const stage = c.stages.find((candidateStage) => candidateStage.id === target);
  if (!stage) {
    throw new CaseModelRequestError("case_not_found", 404, "The requested Case stage is unavailable");
  }
  return {
    result: {
      spokenText: stage.interviewer_prompt,
      stage: target,
      action: "advance",
      exhibit: null,
      complete: false,
      score: current.score ?? null,
      turnSeq: current.turnSeq ?? 0,
    },
    commit: (latest) => ({
      ...latest,
      session: transitionCaseSession(latest.session, target),
      conversationStatus: "active",
      lastProbeObjective: null,
    }),
  };
}

async function evaluateCandidate(
  current: CaseVoiceSession,
  candidate: CandidateRequest,
  timings: CaseTurnTimings,
): Promise<CandidateEvaluation> {
  const c = mockCase(current.caseId);
  if (!c) {
    throw new CaseModelRequestError("case_not_found", 404, "The Case content is unavailable");
  }

  const intentStartedAt = Date.now();
  const routed = routeCaseCandidateTurn(candidate.answer, {
    readinessStatus: current.readinessStatus ?? "confirmed",
    conversationStatus: current.conversationStatus ?? "active",
    stage: current.session.fsm_state,
  });
  const intent = routed.intent;
  timings.intent = intent;
  timings.intentMs += Date.now() - intentStartedAt;

  if (current.readinessStatus === "awaiting") {
    const ready = intent === "readiness-confirmation";
    const authoredPrompt = firstString(c.prompt, c.content);
    if (ready && !authoredPrompt) {
      throw new CaseModelRequestError("case_not_found", 404, "The Case opening is unavailable");
    }
    const spokenText = ready
      ? caseOpeningAfterReadiness(authoredPrompt!)
      : CASE_NOT_READY_RESPONSE;
    const result: CaseVoiceModelResponse = {
      spokenText,
      stage: current.session.fsm_state,
      action: "readiness",
      exhibit: null,
      complete: false,
      score: null,
      turnSeq: current.turnSeq ?? 0,
    };
    return {
      result,
      commit: (latest) => ({
        ...latest,
        openingText: ready
          ? `${CASE_READINESS_PROMPT}\n\n${spokenText}`
          : latest.openingText,
        readinessStatus: ready ? "confirmed" : "awaiting",
        readinessConfirmedAt: ready ? new Date().toISOString() : null,
        conversationStatus: "active",
      }),
    };
  }

  if (
    intent === "readiness-confirmation" &&
    (current.conversationStatus ?? "active") !== "paused" &&
    (current.turnSeq ?? 0) === 0 &&
    (current.projectedTurns?.length ?? 0) === 0
  ) {
    return {
      result: {
        spokenText: CASE_ALREADY_READY_RESPONSE,
        stage: current.session.fsm_state,
        action: "readiness",
        exhibit: null,
        complete: false,
        score: null,
        turnSeq: 0,
      },
      commit: (latest) => latest,
    };
  }

  if (!caseIntentUsesEvaluator(intent)) {
    if (intent === "frustration") return frustrationEvaluation(current, c);
    if (intent === "stage-transition-request" && routed.transitionTo) {
      return stageTransitionEvaluation(current, c, routed.transitionTo);
    }
    return metaConversationEvaluation(current, intent);
  }

  const evaluationText = routed.evaluationText;
  const stageBefore = routed.transitionTo ?? current.session.fsm_state;
  const frameworkAssessment = stageBefore === "framework"
    ? assessCaseFramework(
        c,
        collectCaseFrameworkEvidence(current.session, evaluationText),
      )
    : undefined;
  const directFrameworkAssessment = stageBefore === "framework"
    ? assessCaseFramework(c, evaluationText)
    : undefined;
  const answeredLastProbe = Boolean(
    current.lastProbeObjective &&
      directFrameworkAssessment &&
      frameworkProbeObjectiveAnswered(
        current.lastProbeObjective,
        directFrameworkAssessment,
      ),
  );
  const evaluatorStartedAt = Date.now();
  const runnerTimings: CaseRunnerTimings = {};
  const turn = await respondToCase(c, current.session, evaluationText, {
    prefetchOnAdvance: false,
    timings: runnerTimings,
    transitionBeforeEvaluation: routed.transitionTo ?? undefined,
  });
  timings.respondToCaseMs += Date.now() - evaluatorStartedAt;
  timings.evaluatorMs += runnerTimings.evaluationMs ?? 0;
  timings.prefetchMs += runnerTimings.prefetchMs ?? 0;
  timings.scoringMs += runnerTimings.scoringMs ?? 0;
  const turnSeq = (current.turnSeq ?? 0) + 1;
  const score = turn.score ?? current.score ?? null;
  const timestamp = new Date().toISOString();
  const spokenText = caseConversationText({
    candidateText: candidate.answer,
    stageBefore,
    stageAfter: turn.session.fsm_state,
    action: turn.interviewer.action,
    backendText: turn.interviewer.text,
    exhibit: turn.interviewer.exhibit,
    complete: turn.session.complete || turn.session.fsm_state === "scoring",
    evaluation: turn.evaluation,
    variationSeed: candidate.cacheKey,
    frameworkAssessment,
  });
  const result: CaseVoiceModelResponse = {
    spokenText,
    stage: turn.session.fsm_state,
    action: turn.interviewer.action,
    exhibit: turn.interviewer.exhibit,
    complete: turn.session.complete || turn.session.fsm_state === "scoring",
    score,
    turnSeq,
  };
  const projectedTurn: CaseVoiceProjectedTurn = {
    turnSeq,
    candidateText: candidate.answer,
    interviewerText: spokenText,
    stage: result.stage,
    action: turn.interviewer.action,
    exhibit: result.exhibit,
    timestamp,
  };
  const lastProbeObjective =
    stageBefore === "framework" &&
      (turn.interviewer.action === "probe" ||
        turn.interviewer.action === "redirect" ||
        turn.interviewer.action === "hint")
      ? answeredLastProbe &&
          frameworkAssessment?.nextProbeObjective?.id === current.lastProbeObjective?.id
        ? null
        : frameworkAssessment?.nextProbeObjective ?? null
      : null;

  return {
    result,
    commit: (latest) => ({
      ...latest,
      session: turn.session,
      turnSeq,
      score,
      invalidRetries: 0,
      conversationStatus: "active",
      lastProbeObjective,
      projectedTurns: [...(latest.projectedTurns ?? []), projectedTurn],
    }),
  };
}

async function processStableCandidate(
  candidate: CandidateRequest,
  timings: CaseTurnTimings,
): Promise<CaseVoiceModelResponse> {
  const deadline = Date.now() + LOCK_WAIT_MILLISECONDS;
  const stabilizationStartedAt = Date.now();
  while (Date.now() < deadline) {
    const current = await loadSession(candidate.sessionId) as CaseVoiceSession | null;
    assertCaseSession(current, candidate);
    timings.stage = current.session.fsm_state;
    const cached = current.processedModelRequests?.[candidate.cacheKey];
    if (cached) return cached;
    const pending = current.pendingCandidate;
    if (!pending || pending.requestKey !== candidate.cacheKey) {
      await delay(LOCK_POLL_MILLISECONDS);
      continue;
    }

    const remaining = pending.updatedAt + revisionWindowMilliseconds() - Date.now();
    if (remaining > 0) {
      await delay(Math.min(remaining, LOCK_POLL_MILLISECONDS));
      continue;
    }

    timings.stabilizationMs = Date.now() - stabilizationStartedAt;
    const turnLockStartedAt = Date.now();
    const processClaim = await acquireTurnLock(
      candidate.sessionId,
      candidate.callId,
      candidate.cacheKey,
    );
    addCaseTurnDuration(timings, "redisLockMs", turnLockStartedAt);
    if ("cached" in processClaim) return processClaim.cached;

    try {
      const guardStartedAt = Date.now();
      const guard = await acquirePendingLock(candidate.sessionId);
      addCaseTurnDuration(timings, "redisLockMs", guardStartedAt);
      let snapshot: CaseVoiceSession;
      try {
        const latest = await loadSession(candidate.sessionId) as CaseVoiceSession | null;
        assertCaseSession(latest, candidate);
        const latestCached = latest.processedModelRequests?.[candidate.cacheKey];
        if (latestCached) return latestCached;
        if (
          !latest.pendingCandidate ||
          latest.pendingCandidate.requestKey !== candidate.cacheKey ||
          latest.pendingCandidate.updatedAt + revisionWindowMilliseconds() > Date.now()
        ) {
          continue;
        }
        snapshot = latest;
      } finally {
        await releaseLock(guard.lockKey, guard.lockToken).catch(() => {});
      }

      const evaluation = await evaluateCandidate(snapshot, candidate, timings);
      const commitGuardStartedAt = Date.now();
      const commitGuard = await acquirePendingLock(candidate.sessionId);
      addCaseTurnDuration(timings, "redisLockMs", commitGuardStartedAt);
      try {
        const latest = await loadSession(candidate.sessionId) as CaseVoiceSession | null;
        assertCaseSession(latest, candidate);
        const latestCached = latest.processedModelRequests?.[candidate.cacheKey];
        if (latestCached) return latestCached;

        if (!latest.pendingCandidate || latest.pendingCandidate.requestKey !== candidate.cacheKey) {
          const ignored = suppressedResult(latest);
          await saveSession(candidate.sessionId, {
            ...latest,
            processedModelRequests: cacheWith(
              latest.processedModelRequests,
              candidate.cacheKey,
              ignored,
            ),
            updatedAt: new Date().toISOString(),
          });
          logTurnDiagnostic(candidate, latest.session.fsm_state, "ignored");
          return ignored;
        }

        const committed = evaluation.commit(latest);
        const updated: CaseVoiceSession = {
          ...committed,
          callId: latest.callId ?? candidate.callId,
          responseSeq: (latest.responseSeq ?? 0) + 1,
          pendingCandidate: null,
          processedModelRequests: cacheWith(
            latest.processedModelRequests,
            candidate.cacheKey,
            evaluation.result,
          ),
          updatedAt: new Date().toISOString(),
        };
        const persistenceStartedAt = Date.now();
        await saveSession(candidate.sessionId, updated);
        addCaseTurnDuration(timings, "persistenceMs", persistenceStartedAt);
        logTurnDiagnostic(candidate, snapshot.session.fsm_state, "processed");
        return evaluation.result;
      } finally {
        await releaseLock(commitGuard.lockKey, commitGuard.lockToken).catch(() => {});
      }
    } finally {
      await releaseLock(processClaim.lockKey, processClaim.lockToken).catch(() => {});
    }
  }
  throw new CaseModelRequestError("turn_in_progress", 409, "The candidate turn did not stabilize in time");
}

async function processTurn(
  req: NextRequest,
  body: OpenAIChatRequest,
  timings: CaseTurnTimings,
): Promise<{ result: CaseVoiceModelResponse; cacheKey: string }> {
  const candidate = parseCandidateRequest(req, body);
  timings.requestId = candidate.requestId;
  timings.callId = candidate.callId;
  timings.messageCount = candidate.messages.length;
  logTurnDiagnostic(candidate, "unknown", "received");

  const initial = await loadSession(candidate.sessionId).catch(() => null) as CaseVoiceSession | null;
  assertCaseSession(initial, candidate);
  timings.stage = initial.session.fsm_state;
  const cached = initial.processedModelRequests?.[candidate.cacheKey];
  if (cached) {
    logTurnDiagnostic(
      candidate,
      initial.session.fsm_state,
      cached.suppressed ? "ignored" : "deduplicated",
    );
    return { result: cached, cacheKey: candidate.cacheKey };
  }

  const registered = await registerPendingCandidate(candidate, timings);
  if (registered) {
    logTurnDiagnostic(
      candidate,
      initial.session.fsm_state,
      registered.suppressed ? "ignored" : "deduplicated",
    );
    return { result: registered, cacheKey: candidate.cacheKey };
  }
  const result = await processStableCandidate(candidate, timings);
  return { result, cacheKey: candidate.cacheKey };
}

export async function POST(req: NextRequest) {
  const timings = newCaseTurnTimings();
  const unauthorized = authorizeVapi(req);
  if (unauthorized) {
    const diagnosticBody = process.env.VAPI_CASE_AUTH_DEBUG === "true"
      ? await req.clone().json().catch(() => null) as OpenAIChatRequest | null
      : null;
    logRequestDiagnostic(req, diagnosticBody, unauthorized.status);
    return unauthorized;
  }
  const body = await req.json().catch(() => null) as OpenAIChatRequest | null;
  if (!body || typeof body !== "object") {
    const response = openAIError(
      new CaseModelRequestError("invalid_json", 400, "A JSON request body is required"),
    );
    logRequestDiagnostic(req, body, response.status);
    return response;
  }

  try {
    const { result, cacheKey } = await processTurn(req, body, timings);
    const response = openAIResponse(
      result,
      cacheKey,
      body.model,
      body.stream !== false,
      timings,
    );
    logRequestDiagnostic(req, body, response.status);
    logCaseLatency(timings, response.status);
    return response;
  } catch (error) {
    const response = error instanceof CaseModelRequestError
      ? openAIError(error)
      : openAIError(
        new CaseModelRequestError("internal_error", 500, "The Case turn could not be processed"),
      );
    timings.firstSseChunkMs = Date.now() - timings.startedAt;
    response.headers.set("Server-Timing", caseServerTiming(timings));
    logRequestDiagnostic(req, body, response.status);
    logCaseLatency(timings, response.status);
    return response;
  }
}
