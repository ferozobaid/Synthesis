/**
 * Voice (Vapi) session records.
 *
 * Vapi drives a live voice call while the server owns the durable interview
 * session, keyed by id in Redis. Behavioural uses post-call reporting; Case uses
 * a custom-LLM turn loop. These records wrap the existing live-plane session
 * types unchanged. Server (live) plane only; never imported by client code.
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

/** One durable Case exchange. Candidate and interviewer text are committed together. */
export interface CaseVoiceProjectedTurn {
  turnSeq: number;
  candidateText: string;
  interviewerText: string;
  stage: CaseState;
  action: CaseAction;
  exhibit: CaseExhibit | null;
  timestamp: string;
}

export type CaseVoiceModelAction = CaseAction | "readiness" | "conversation" | "suppressed";

/** Cached backend result for one OpenAI-compatible custom-LLM request. */
export interface CaseVoiceModelResponse {
  spokenText: string;
  stage: CaseState;
  action: CaseVoiceModelAction;
  exhibit: CaseExhibit | null;
  complete: boolean;
  score: CaseScore | null;
  turnSeq: number;
  suppressed?: boolean;
}

/** One not-yet-evaluated Vapi candidate revision awaiting a short stability window. */
export interface CaseVoicePendingCandidate {
  requestKey: string;
  requestId: string | null;
  messageId: string | null;
  callId: string;
  stage: CaseState;
  candidateText: string;
  normalizedText: string;
  messageCount: number;
  receivedAt: number;
  updatedAt: number;
}

export interface CaseVoiceSession {
  module: "case";
  /** The exact CaseSessionState the existing case-runner produces/updates. */
  session: CaseSessionState;
  caseId: string;
  /** Spoken pre-case opening; authored prompt is appended only after readiness. */
  openingText?: string;
  /** Readiness is outside the scored FSM and never creates a projected Case turn. */
  readinessStatus?: "awaiting" | "confirmed";
  readinessConfirmedAt?: string | null;
  /** Voice-only conversational state; never changes the Case FSM or score. */
  conversationStatus?: "active" | "paused";
  /** Bound to the first valid Vapi call id that successfully advances the session. */
  callId?: string | null;
  /** Monotonic sequence for backend-authored interviewer turns returned to Vapi. */
  turnSeq?: number;
  /** Monotonic processed speech sequence, including non-scored conversational replies. */
  responseSeq?: number;
  /** Final score once the wrapped CaseSessionState reaches scoring. */
  score?: CaseScore | null;
  /** Cached Vapi tool-call results keyed by `${callId}:${toolCallId}`. */
  processedToolCalls?: Record<string, CaseVoiceToolResponse>;
  /** Cached custom-LLM results keyed by a stable call/message-history digest. */
  processedModelRequests?: Record<string, CaseVoiceModelResponse>;
  /** Candidate text held briefly so progressive Vapi revisions replace rather than advance. */
  pendingCandidate?: CaseVoicePendingCandidate | null;
  /** Permanent browser transcript source, ordered by turnSeq. */
  projectedTurns?: CaseVoiceProjectedTurn[];
  /** SHA-256 (hex) of the bootstrap projection token; raw token is client-only. */
  projectionTokenHash?: string;
  /** Invalid answer retries returned to Vapi without mutating the Case FSM session. */
  invalidRetries?: number;
  createdAt: string;
  updatedAt: string;
}

export type VoiceSession = BehaviouralVoiceSession | CaseVoiceSession;
