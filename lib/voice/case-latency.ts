import type { CaseCandidateIntent } from "@/lib/voice/case-intent";

export interface CaseTurnTimings {
  startedAt: number;
  coldStart: boolean;
  requestId: string | null;
  callId: string | null;
  messageCount: number;
  stage: string;
  intent: CaseCandidateIntent | "unknown";
  stabilizationMs: number;
  redisLockMs: number;
  intentMs: number;
  evaluatorMs: number;
  respondToCaseMs: number;
  prefetchMs: number;
  scoringMs: number;
  persistenceMs: number;
  firstSseChunkMs: number;
}

let firstInvocation = true;

export function newCaseTurnTimings(): CaseTurnTimings {
  const coldStart = firstInvocation;
  firstInvocation = false;
  return {
    startedAt: Date.now(),
    coldStart,
    requestId: null,
    callId: null,
    messageCount: 0,
    stage: "unknown",
    intent: "unknown",
    stabilizationMs: 0,
    redisLockMs: 0,
    intentMs: 0,
    evaluatorMs: 0,
    respondToCaseMs: 0,
    prefetchMs: 0,
    scoringMs: 0,
    persistenceMs: 0,
    firstSseChunkMs: 0,
  };
}

export function addCaseTurnDuration(
  timings: CaseTurnTimings,
  key: "redisLockMs" | "persistenceMs",
  startedAt: number,
): void {
  timings[key] += Date.now() - startedAt;
}

export function caseServerTiming(timings: CaseTurnTimings): string {
  const total = Date.now() - timings.startedAt;
  return [
    `total;dur=${total}`,
    `stabilize;dur=${timings.stabilizationMs}`,
    `redis_lock;dur=${timings.redisLockMs}`,
    `intent;dur=${timings.intentMs}`,
    `evaluator;dur=${timings.evaluatorMs}`,
    `respond_to_case;dur=${timings.respondToCaseMs}`,
    `prefetch;dur=${timings.prefetchMs}`,
    `scoring;dur=${timings.scoringMs}`,
    `persist;dur=${timings.persistenceMs}`,
    `sse_ready;dur=${timings.firstSseChunkMs}`,
  ].join(", ");
}

export function logCaseLatency(timings: CaseTurnTimings, statusCode: number): void {
  if (process.env.NODE_ENV === "test" && process.env.VAPI_CASE_LATENCY_DEBUG !== "true") return;
  console.info("[case-custom-llm] latency", {
    requestId: timings.requestId ?? "absent",
    callId: timings.callId ?? "absent",
    messageCount: timings.messageCount,
    stage: timings.stage,
    candidateIntent: timings.intent,
    coldStart: timings.coldStart,
    stabilizationMs: timings.stabilizationMs,
    redisLockMs: timings.redisLockMs,
    intentMs: timings.intentMs,
    evaluatorMs: timings.evaluatorMs,
    respondToCaseMs: timings.respondToCaseMs,
    prefetchMs: timings.prefetchMs,
    scoringMs: timings.scoringMs,
    persistenceMs: timings.persistenceMs,
    firstSseChunkMs: timings.firstSseChunkMs,
    totalMs: Date.now() - timings.startedAt,
    statusCode,
    requestReceivedAt: new Date(timings.startedAt).toISOString(),
    firstSseChunkAt: new Date(timings.startedAt + timings.firstSseChunkMs).toISOString(),
    timestamp: new Date().toISOString(),
  });
}
