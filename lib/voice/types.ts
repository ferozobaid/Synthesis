/**
 * Voice (Vapi) session records.
 *
 * Vapi drives a live voice call and reaches the server through small tool-call
 * webhooks — it cannot ferry the full session object the way the browser does
 * (see app/behavioural/page.tsx / app/case/page.tsx). So the server owns the
 * session, keyed by id in Redis, and these records wrap the *existing* live-plane
 * session types unchanged. Server (live) plane only; never imported by client code.
 */
import type {
  CaseAction,
  CaseExhibit,
  CaseScore,
  BehaviouralQuestion,
  BehaviouralSession,
  CaseSessionState,
  CaseState,
} from "@/lib/types";
import type { BehaviouralSummary } from "@/lib/behavioural/runner";

/** Lifecycle of the post-call scoring report for a behavioural voice session. */
export type ReportStatus = "pending" | "processing" | "done" | "failed";

/** A behavioural voice session: the existing session plus the server-owned cursor. */
export interface BehaviouralVoiceSession {
  module: "behavioural";
  /** The exact BehaviouralSession the existing runner produces/updates. */
  session: BehaviouralSession;
  /** The frozen question batch (so question text is stable across turns). */
  questions: BehaviouralQuestion[];
  /** Cursor into `questions` — the browser's local `idx`, moved server-side. */
  questionIndex: number;
  createdAt: string;
  updatedAt: string;

  // --- Post-call scoring (populated by the end-of-call-report webhook) --------
  /** Lifecycle of the final report; "pending" at bootstrap. */
  reportStatus?: ReportStatus;
  /** The aggregate report, present only once reportStatus === "done". */
  report?: BehaviouralSummary | null;
  /** Failure message, present only once reportStatus === "failed". */
  reportError?: string | null;
  /** Vapi call id that produced (or is producing) the report — idempotency key. */
  processedCallId?: string | null;
  /** ISO timestamp when processing was claimed — used for stale-lease recovery. */
  processingStartedAt?: string | null;
  /** SHA-256 (hex) of the bootstrap report token; the raw token is client-only. */
  reportTokenHash?: string;
  /** Candidate/role/company context captured at bootstrap (for the report). */
  context?: {
    candidateName: string | null;
    targetRole: string | null;
    companyName: string | null;
  };
}

/** A case voice session: the existing FSM session state plus the case id. */
export interface CaseVoiceToolResponse {
  spokenText: string;
  stage: CaseState | null;
  stageIndex: number;
  action: CaseAction | "retry" | null;
  exhibit: CaseExhibit | null;
  complete: boolean;
  score: CaseScore | null;
  turnSeq: number;
  duplicate?: boolean;
  error?: string;
  retryable?: boolean;
  retryCount?: number;
  maxRetries?: number;
}

export interface CaseVoiceSession {
  module: "case";
  /** The exact CaseSessionState the existing case-runner produces/updates. */
  session: CaseSessionState;
  caseId: string;
  /** Bound to the first valid Vapi call id that successfully advances the session. */
  callId?: string | null;
  /** Monotonic sequence for backend-authored interviewer turns returned to Vapi. */
  turnSeq?: number;
  /** Final score once the wrapped CaseSessionState reaches scoring. */
  score?: CaseScore | null;
  /** Cached Vapi tool-call results keyed by `${callId}:${toolCallId}`. */
  processedToolCalls?: Record<string, CaseVoiceToolResponse>;
  /** SHA-256 (hex) of the bootstrap projection token; raw token is client-only. */
  projectionTokenHash?: string;
  /** Invalid answer retries returned to Vapi without mutating the Case FSM session. */
  invalidRetries?: number;
  createdAt: string;
  updatedAt: string;
}

export type VoiceSession = BehaviouralVoiceSession | CaseVoiceSession;
