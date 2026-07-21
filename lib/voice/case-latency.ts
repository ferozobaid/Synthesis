export interface CaseTurnTimings {
  startedAt: number;
  coldStart: boolean;
  requestId: string | null;
  correlationId: string | null;
  callId: string | null;
  messageCount: number;
  stage: string;
  interviewerMode: "legacy" | "llm";
  interviewerCalls: number;
  interviewerMs: number;
  interviewerOutcome: string;
  interviewerFallbackReason: string;
  intent: string;
  readinessDisposition: "not_applicable" | "affirmative" | "negative" | "mixed" | "unknown";
  stabilizationMs: number;
  tentativeReadinessDetected: boolean;
  tentativeTransitionDetected: boolean;
  tentativeStabilizationMs: number;
  redisLockMs: number;
  pendingLockWaitMs: number;
  turnLockWaitMs: number;
  deterministicTriageMs: number;
  controllerRequired: boolean;
  controllerMs: number;
  controllerOutcome: string;
  controllerIntent: string;
  controllerApplied: boolean;
  controllerConfidenceBucket: number;
  controllerTimeout: boolean;
  controllerValidationFailure: boolean;
  evaluatorCalled: boolean;
  intentMs: number;
  evaluatorMs: number;
  respondToCaseMs: number;
  prefetchMs: number;
  scoringMs: number;
  persistenceMs: number;
  firstSseChunkMs: number;
  responseReadyMs: number;
  responseKind:
    | "unknown"
    | "authoritative_non_empty"
    | "replayed_non_empty"
    | "suppressed_empty"
    | "safe_fallback_non_empty";
  spokenTextEmpty: boolean;
  logicalTurnCompleted: boolean;
  authoritativeResponsePresent: boolean;
  authoritativeResponseSource: "none" | "committed" | "logical_cache" | "request_cache" | "suppressed";
  logicalResponseReplay: boolean;
}

let firstInvocation = true;

export function newCaseTurnTimings(): CaseTurnTimings {
  const coldStart = firstInvocation;
  firstInvocation = false;
  return {
    startedAt: Date.now(),
    coldStart,
    requestId: null,
    correlationId: null,
    callId: null,
    messageCount: 0,
    stage: "unknown",
    interviewerMode: "legacy",
    interviewerCalls: 0,
    interviewerMs: 0,
    interviewerOutcome: "not_required",
    interviewerFallbackReason: "none",
    intent: "unknown",
    readinessDisposition: "not_applicable",
    stabilizationMs: 0,
    tentativeReadinessDetected: false,
    tentativeTransitionDetected: false,
    tentativeStabilizationMs: 0,
    redisLockMs: 0,
    pendingLockWaitMs: 0,
    turnLockWaitMs: 0,
    deterministicTriageMs: 0,
    controllerRequired: false,
    controllerMs: 0,
    controllerOutcome: "not_required",
    controllerIntent: "not_required",
    controllerApplied: false,
    controllerConfidenceBucket: 0,
    controllerTimeout: false,
    controllerValidationFailure: false,
    evaluatorCalled: false,
    intentMs: 0,
    evaluatorMs: 0,
    respondToCaseMs: 0,
    prefetchMs: 0,
    scoringMs: 0,
    persistenceMs: 0,
    firstSseChunkMs: 0,
    responseReadyMs: 0,
    responseKind: "unknown",
    spokenTextEmpty: false,
    logicalTurnCompleted: false,
    authoritativeResponsePresent: false,
    authoritativeResponseSource: "none",
    logicalResponseReplay: false,
  };
}

export function addCaseTurnDuration(
  timings: CaseTurnTimings,
  key: "redisLockMs" | "pendingLockWaitMs" | "turnLockWaitMs" | "persistenceMs",
  startedAt: number,
): void {
  timings[key] += Date.now() - startedAt;
}

export function caseServerTiming(timings: CaseTurnTimings): string {
  const total = Date.now() - timings.startedAt;
  return [
    `total;dur=${total}`,
    `stabilize;dur=${timings.stabilizationMs}`,
    `tentative_stabilize;dur=${timings.tentativeStabilizationMs}`,
    `redis_lock;dur=${timings.redisLockMs}`,
    `pending_lock;dur=${timings.pendingLockWaitMs}`,
    `turn_lock;dur=${timings.turnLockWaitMs}`,
    `triage;dur=${timings.deterministicTriageMs}`,
    `controller;dur=${timings.controllerMs}`,
    `interviewer;dur=${timings.interviewerMs}`,
    `intent;dur=${timings.intentMs}`,
    `evaluator;dur=${timings.evaluatorMs}`,
    `respond_to_case;dur=${timings.respondToCaseMs}`,
    `prefetch;dur=${timings.prefetchMs}`,
    `scoring;dur=${timings.scoringMs}`,
    `persist;dur=${timings.persistenceMs}`,
    `sse_ready;dur=${timings.firstSseChunkMs}`,
    `response_ready;dur=${timings.responseReadyMs}`,
  ].join(", ");
}

export function logCaseLatency(timings: CaseTurnTimings, statusCode: number): void {
  if (process.env.NODE_ENV === "test" && process.env.VAPI_CASE_LATENCY_DEBUG !== "true") return;
  console.info("[case-custom-llm] latency", {
    correlationId: timings.correlationId ?? "absent",
    callId: timings.callId ?? "absent",
    messageCount: timings.messageCount,
    stage: timings.stage,
    interviewerMode: timings.interviewerMode,
    interviewerCalls: timings.interviewerCalls,
    interviewerMs: timings.interviewerMs,
    interviewerOutcome: timings.interviewerOutcome,
    interviewerFallbackReason: timings.interviewerFallbackReason,
    candidateIntent: timings.intent,
    readinessDisposition: timings.readinessDisposition,
    coldStart: timings.coldStart,
    stabilizationMs: timings.stabilizationMs,
    tentativeReadinessDetected: timings.tentativeReadinessDetected,
    tentativeTransitionDetected: timings.tentativeTransitionDetected,
    tentativeStabilizationMs: timings.tentativeStabilizationMs,
    redisLockMs: timings.redisLockMs,
    pendingLockWaitMs: timings.pendingLockWaitMs,
    turnLockWaitMs: timings.turnLockWaitMs,
    deterministicTriageMs: timings.deterministicTriageMs,
    controllerRequired: timings.controllerRequired,
    controllerMs: timings.controllerMs,
    controllerOutcome: timings.controllerOutcome,
    controllerIntent: timings.controllerIntent,
    controllerApplied: timings.controllerApplied,
    controllerConfidenceBucket: timings.controllerConfidenceBucket,
    controllerTimeout: timings.controllerTimeout,
    controllerValidationFailure: timings.controllerValidationFailure,
    evaluatorCalled: timings.evaluatorCalled,
    intentMs: timings.intentMs,
    evaluatorMs: timings.evaluatorMs,
    respondToCaseMs: timings.respondToCaseMs,
    prefetchMs: timings.prefetchMs,
    scoringMs: timings.scoringMs,
    persistenceMs: timings.persistenceMs,
    firstSseChunkMs: timings.firstSseChunkMs,
    responseReadyMs: timings.responseReadyMs,
    responseKind: timings.responseKind,
    spokenTextEmpty: timings.spokenTextEmpty,
    logicalTurnCompleted: timings.logicalTurnCompleted,
    authoritativeResponsePresent: timings.authoritativeResponsePresent,
    authoritativeResponseSource: timings.authoritativeResponseSource,
    logicalResponseReplay: timings.logicalResponseReplay,
    totalBackendMs: Date.now() - timings.startedAt,
    statusCode,
    requestReceivedAt: new Date(timings.startedAt).toISOString(),
    firstSseChunkAt: new Date(timings.startedAt + timings.firstSseChunkMs).toISOString(),
    timestamp: new Date().toISOString(),
  });
}
