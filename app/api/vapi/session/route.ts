import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { startBehavioural } from "@/lib/behavioural/runner";
import { initSession } from "@/lib/fsm/case-fsm";
import {
  MOCK_JD_TEXT,
  MOCK_QUESTIONS,
  MOCK_USER_ID,
} from "@/lib/__mocks__/fixtures";
import { useMocks } from "@/lib/config";
import { saveSession } from "@/lib/voice/session-store";
import { CASE_STATES } from "@/lib/types";
import type { BehaviouralVoiceSession, CaseVoiceSession } from "@/lib/voice/types";
import { caseReadinessPrompt } from "@/lib/voice/case-conversation";
import { CASE_VOICE_LLM_VERSION } from "@/lib/voice/case-interviewer-mode";
import { isPreviewLlmCaseId, previewLlmCaseCatalogEntry } from "@/lib/voice/case-catalog";
import { voiceCaseRecord } from "@/lib/voice/voice-case-records";

// POST /api/vapi/session — bootstrap a voice session (called when a call starts).
//   { module: "behavioural", jdText, candidateName?, targetRole?, companyName? }
//     -> { sessionId, firstQuestion, candidateName, targetRole, companyName }
//   { module: "case", caseId, candidateName? }
//     -> { sessionId, openingPrompt, caseTitle, candidateName }
//
// Reuses the existing startBehavioural / startCase implementations and persists
// the server-owned session in Redis for the live voice routes.

const MAX_JD_LENGTH = 20_000;
const MAX_NAME_LENGTH = 200;
const MAX_CASE_ID_LENGTH = 100;
function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function newSessionId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `vsess-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const module = (body as { module?: unknown }).module;

  if (module === "behavioural") {
    const jdRaw = asString((body as { jdText?: unknown }).jdText) ?? "";
    if (jdRaw.length > MAX_JD_LENGTH) {
      return NextResponse.json({ error: "jdText exceeds length limit" }, { status: 400 });
    }
    const candidateName = asString((body as { candidateName?: unknown }).candidateName);
    const targetRole = asString((body as { targetRole?: unknown }).targetRole);
    const companyName = asString((body as { companyName?: unknown }).companyName);
    for (const [field, value] of Object.entries({ candidateName, targetRole, companyName })) {
      if (value !== undefined && value.length > MAX_NAME_LENGTH) {
        return NextResponse.json({ error: `${field} exceeds length limit` }, { status: 400 });
      }
    }

    // Mirror the existing /api/behavioural route: fall back to the sample JD in
    // mock mode so "why this company" stays grounded without a pasted JD.
    const jdText = jdRaw.trim() ? jdRaw : useMocks() ? MOCK_JD_TEXT : "";
    const started = startBehavioural({
      questionBank: MOCK_QUESTIONS,
      jdText,
      userId: MOCK_USER_ID,
    });

    const now = new Date().toISOString();
    const sessionId = newSessionId();

    // Report access capability: return the raw token to the client ONCE; persist
    // only its SHA-256 so the status endpoint can verify without storing the token.
    const reportToken = randomBytes(32).toString("hex");
    const reportTokenHash = createHash("sha256").update(reportToken).digest("hex");

    const resolvedRole = targetRole ?? started.jd?.role_title ?? null;
    const resolvedCompany = companyName ?? started.jd?.company ?? null;
    const resolvedName = candidateName ?? null;

    const record: BehaviouralVoiceSession = {
      module: "behavioural",
      session: started.session,
      questions: started.questions,
      questionIndex: 0,
      reportStatus: "pending",
      report: null,
      reportError: null,
      processedCallId: null,
      processingStartedAt: null,
      reportTokenHash,
      context: {
        candidateName: resolvedName,
        targetRole: resolvedRole,
        companyName: resolvedCompany,
      },
      createdAt: now,
      updatedAt: now,
    };
    await saveSession(sessionId, record);

    // Numbered, ordered list handed to Vapi as the {{questionList}} variable so the
    // assistant asks every core question in order (post-call scoring owns grading).
    const questionList = started.questions
      .map((q, i) => `${i + 1}. ${q.question}`)
      .join("\n");

    return NextResponse.json({
      sessionId,
      reportToken,
      firstQuestion: started.questions[0] ?? null,
      // Complete ordered question set (stable ids + text) + the numbered string.
      questions: started.questions.map((q) => ({ id: q.id, question: q.question })),
      questionList,
      candidateName: resolvedName,
      targetRole: resolvedRole,
      companyName: resolvedCompany,
    });
  }

  if (module === "case") {
    const requestedCaseId = asString((body as { caseId?: unknown }).caseId);
    if (requestedCaseId !== undefined && requestedCaseId.length > MAX_CASE_ID_LENGTH) {
      return NextResponse.json({ error: "caseId exceeds length limit" }, { status: 400 });
    }
    const candidateName = asString((body as { candidateName?: unknown }).candidateName);
    if (candidateName !== undefined && candidateName.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: "candidateName exceeds length limit" }, { status: 400 });
    }

    // The Case Simulator supports exactly two LLM cases. Require an explicit,
    // catalog-listed selection and fail closed (400) on a missing, unknown, or
    // retired (Beautify/Diconsa) id. Never default to a case.
    if (!requestedCaseId) {
      return NextResponse.json({ error: "caseId required" }, { status: 400 });
    }
    if (!isPreviewLlmCaseId(requestedCaseId)) {
      return NextResponse.json({ error: "unsupported_case" }, { status: 400 });
    }
    const resolvedCaseId = requestedCaseId;

    const c = voiceCaseRecord(resolvedCaseId);
    if (!c) {
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    const catalogEntry = previewLlmCaseCatalogEntry(resolvedCaseId);

    // Readiness is a voice-only pre-case gate. The authored prompt is withheld
    // until the candidate confirms they are ready. The two cases always run the
    // LLM interviewer (v2) — there is no legacy voice path.
    const voiceSession = {
      ...initSession(MOCK_USER_ID, resolvedCaseId),
      fsm_state: "clarification" as const,
    };
    const openingText = caseReadinessPrompt(resolvedCaseId);
    const now = new Date().toISOString();
    const sessionId = newSessionId();
    const projectionToken = randomBytes(32).toString("hex");
    const projectionTokenHash = createHash("sha256").update(projectionToken).digest("hex");
    const record: CaseVoiceSession = {
      module: "case",
      session: voiceSession,
      caseId: resolvedCaseId,
      selectedCaseTitle: catalogEntry?.title ?? c.title,
      selectedCaseDescription: catalogEntry?.description,
      interviewerMode: "llm",
      interviewerVersion: CASE_VOICE_LLM_VERSION,
      liveStatus: "active",
      concludedAt: null,
      openingText,
      readinessStatus: "awaiting",
      readinessConfirmedAt: null,
      conversationStatus: "active",
      callId: null,
      turnSeq: 0,
      responseSeq: 0,
      score: null,
      processedToolCalls: {},
      processedModelRequests: {},
      processedLogicalTurns: {},
      pendingCandidate: null,
      probedAnswerHashes: {},
      stageProbeCounts: {},
      projectedTurns: [],
      projectionTokenHash,
      invalidRetries: 0,
      createdAt: now,
      updatedAt: now,
    };
    await saveSession(sessionId, record);

    return NextResponse.json({
      sessionId,
      projectionToken,
      openingPrompt: openingText,
      caseId: resolvedCaseId,
      caseTitle: c.title,
      caseDescription: catalogEntry?.description ?? null,
      stage: voiceSession.fsm_state,
      stageIndex: CASE_STATES.indexOf(voiceSession.fsm_state),
      candidateName: candidateName ?? null,
    });
  }

  return NextResponse.json({ error: "invalid module" }, { status: 400 });
}
