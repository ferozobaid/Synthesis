import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizeVapi } from "@/lib/voice/vapi";
import {
  acquireLock,
  loadSession,
  releaseLock,
  saveCaseSessionIfReportFence,
  saveSession,
} from "@/lib/voice/session-store";
import { storedCaseVoiceArchitecture } from "@/lib/voice/case-native-config";
import { normalizeVoiceTranscript } from "@/lib/voice/transcript";
import { mapCaseTranscript } from "@/lib/voice/case-transcript";
import { scoreCasePostCall } from "@/lib/voice/case-post-call-scorer";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";
import type { CaseVoiceSession } from "@/lib/voice/types";

export const maxDuration = 300;

const LOCK_LEASE_SECONDS = 180;
const STALE_PROCESSING_MS = 150_000;

type SafeScorerOutcome = "model" | "deterministic_fallback" | "failed";
type SafeScorerFailureCategory =
  | "mock_mode"
  | "invalid_model_output"
  | "unsafe_model_output"
  | "model_error"
  | "empty_transcript"
  | "unusable_transcript"
  | "stage_anchor_unavailable"
  | "scoring_failed"
  | "unknown"
  | null;

const SAFE_FAILURE_CATEGORIES = new Set<Exclude<SafeScorerFailureCategory, null>>([
  "mock_mode",
  "invalid_model_output",
  "unsafe_model_output",
  "model_error",
  "empty_transcript",
  "unusable_transcript",
  "stage_anchor_unavailable",
  "scoring_failed",
  "unknown",
]);

function safeFailureCategory(value: unknown): SafeScorerFailureCategory {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && SAFE_FAILURE_CATEGORIES.has(
    value as Exclude<SafeScorerFailureCategory, null>,
  )
    ? value as Exclude<SafeScorerFailureCategory, null>
    : "unknown";
}

function recordCasePostCallScoringDiagnostic(input: {
  sessionCorrelationId: string;
  selectedCaseId: string;
  observedStageCount: number;
  missingStageCount: number;
  partial: boolean;
  scorerOutcome: SafeScorerOutcome;
  scorerDurationMs: number;
  reportStatus: "done" | "failed";
  failureCategory: SafeScorerFailureCategory;
}): void {
  console.info("[case-native-report] scoring", input);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function resolveSessionId(message: Record<string, unknown>): string | null {
  const m = message as any;
  return firstString(
    m?.artifact?.variableValues?.sessionId,
    m?.call?.artifact?.variableValues?.sessionId,
    m?.call?.assistantOverrides?.variableValues?.sessionId,
    m?.call?.assistantOverrides?.metadata?.sessionId,
    m?.assistantOverrides?.variableValues?.sessionId,
  );
}

function resolveCallId(message: Record<string, unknown>): string | null {
  const m = message as any;
  return firstString(m?.call?.id, m?.artifact?.call?.id, m?.callId);
}

function resolveAssistantId(message: Record<string, unknown>): string | null {
  const m = message as any;
  return firstString(m?.call?.assistantId, m?.assistant?.id, m?.assistantId);
}

function resolveCaseId(message: Record<string, unknown>): string | null {
  const m = message as any;
  return firstString(
    m?.artifact?.variableValues?.caseId,
    m?.call?.assistantOverrides?.variableValues?.caseId,
  );
}

const ack = () => NextResponse.json({ ok: true }, { status: 200 });
const retry = () => NextResponse.json({ error: "temporary_unavailable" }, { status: 503 });

function isFreshProcessing(record: CaseVoiceSession): boolean {
  if (record.reportStatus !== "processing" || !record.reportProcessingStartedAt) return false;
  const age = Date.now() - Date.parse(record.reportProcessingStartedAt);
  return Number.isFinite(age) && age >= 0 && age < STALE_PROCESSING_MS;
}

export async function POST(req: NextRequest) {
  const unauthorized = authorizeVapi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const message = (body as { message?: Record<string, unknown> } | null)?.message;
  if (!message || message.type !== "end-of-call-report") return ack();

  const sessionId = resolveSessionId(message);
  const callId = resolveCallId(message);
  const assistantId = resolveAssistantId(message);
  const suppliedCaseId = resolveCaseId(message);
  if (!sessionId || !callId || !assistantId) return ack();

  const lockKey = `lock:case-report:${sessionId}`;
  let lockToken: string | null;
  try {
    lockToken = await acquireLock(lockKey, LOCK_LEASE_SECONDS);
  } catch {
    return retry();
  }
  if (!lockToken) return ack();

  try {
    let record: CaseVoiceSession;
    try {
      const loaded = await loadSession(sessionId);
      if (!loaded || loaded.module !== "case") return ack();
      record = loaded;
    } catch {
      return retry();
    }

    if (storedCaseVoiceArchitecture(record) !== "vapi_native") return ack();
    if (!record.expectedAssistantId || assistantId !== record.expectedAssistantId) return ack();
    if (suppliedCaseId && suppliedCaseId !== record.caseId) return ack();
    if (record.authoritativeCallId && record.authoritativeCallId !== callId) return ack();
    if (record.reportStatus === "done" || record.reportStatus === "failed") return ack();
    if (isFreshProcessing(record)) return ack();

    const caseRecord = getVoiceLlmCaseRecord(record.caseId);
    const stageAnchorVersion = record.stageAnchorVersion;
    if (!caseRecord || !stageAnchorVersion) return ack();

    // artifact.messages is the sole transcript input; raw webhook material is
    // neither logged nor persisted.
    const normalized = normalizeVoiceTranscript((message as any)?.artifact?.messages);
    const mapped = mapCaseTranscript(
      record.caseId,
      stageAnchorVersion,
      normalized.turns,
      { truncated: normalized.truncated },
    );
    const attempt = (record.reportAttempt ?? 0) + 1;
    const fencingToken = randomBytes(24).toString("hex");
    const now = new Date().toISOString();
    const claimed: CaseVoiceSession = {
      ...record,
      authoritativeCallId: record.authoritativeCallId ?? callId,
      reportStatus: "processing",
      reportAttempt: attempt,
      reportFencingToken: fencingToken,
      reportProcessingStartedAt: now,
      normalizedTranscript: normalized.turns,
      finalReport: null,
      reportErrorCode: null,
      updatedAt: now,
    };

    try {
      await saveSession(sessionId, claimed);
    } catch {
      return retry();
    }

    let final: CaseVoiceSession;
    let scorerOutcome: SafeScorerOutcome = "failed";
    let failureCategory: SafeScorerFailureCategory = null;
    const scorerStartedAt = Date.now();
    if (!mapped) {
      failureCategory = "stage_anchor_unavailable";
      final = {
        ...claimed,
        reportStatus: "failed",
        reportProcessingStartedAt: null,
        finalReport: null,
        reportErrorCode: "stage_anchor_unavailable",
        updatedAt: new Date().toISOString(),
      };
    } else {
      try {
        const scoring = await scoreCasePostCall(caseRecord, mapped);
        scorerOutcome = scoring.ok
          ? scoring.scorerOutcome ?? "deterministic_fallback"
          : "failed";
        failureCategory = scoring.ok
          ? safeFailureCategory(scoring.failureCategory)
          : safeFailureCategory(scoring.failureCode);
        final = scoring.ok
          ? {
              ...claimed,
              reportStatus: "done",
              reportProcessingStartedAt: null,
              finalReport: scoring.report,
              reportErrorCode: null,
              updatedAt: new Date().toISOString(),
            }
          : {
              ...claimed,
              reportStatus: "failed",
              reportProcessingStartedAt: null,
              finalReport: null,
              reportErrorCode: scoring.failureCode,
              updatedAt: new Date().toISOString(),
            };
      } catch {
        scorerOutcome = "failed";
        failureCategory = "scoring_failed";
        final = {
          ...claimed,
          reportStatus: "failed",
          reportProcessingStartedAt: null,
          finalReport: null,
          reportErrorCode: "scoring_failed",
          updatedAt: new Date().toISOString(),
        };
      }
    }

    recordCasePostCallScoringDiagnostic({
      sessionCorrelationId: sessionId,
      selectedCaseId: record.caseId,
      observedStageCount: mapped?.observedStages.length ?? 0,
      missingStageCount: mapped?.missingStages.length ?? 6,
      partial: mapped?.partial ?? true,
      scorerOutcome,
      scorerDurationMs: Math.max(0, Date.now() - scorerStartedAt),
      reportStatus: final.reportStatus === "done" ? "done" : "failed",
      failureCategory,
    });

    try {
      await saveCaseSessionIfReportFence(sessionId, attempt, fencingToken, final);
    } catch {
      return retry();
    }
    return ack();
  } finally {
    await releaseLock(lockKey, lockToken).catch(() => {});
  }
}
