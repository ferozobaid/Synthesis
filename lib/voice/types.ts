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
