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
  BehaviouralQuestion,
  BehaviouralSession,
  CaseSessionState,
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
export interface CaseVoiceSession {
  module: "case";
  /** The exact CaseSessionState the existing case-runner produces/updates. */
  session: CaseSessionState;
  caseId: string;
  createdAt: string;
  updatedAt: string;
}

export type VoiceSession = BehaviouralVoiceSession | CaseVoiceSession;
