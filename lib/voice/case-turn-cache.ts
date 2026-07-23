import { createHash } from "node:crypto";
import {
  CASE_VOICE_CONTROLLER_VERSION,
  caseVoiceControllerMode,
  type CaseVoiceControllerMode,
} from "@/lib/voice/case-turn-plan";

export interface CaseTurnCacheMessage {
  role: string;
  content: string;
}

interface ControllerCacheIdentity {
  mode?: CaseVoiceControllerMode;
  version?: string;
}

export interface CaseVoiceLlmCacheIdentity {
  interviewerMode: "llm";
  interviewerVersion: string;
  selectedCaseId: string;
}

export type CaseVoiceCacheIdentity = ControllerCacheIdentity | CaseVoiceLlmCacheIdentity;

function controllerIdentity(overrides: ControllerCacheIdentity = {}) {
  return {
    mode: overrides.mode ?? caseVoiceControllerMode(),
    version: overrides.version ?? CASE_VOICE_CONTROLLER_VERSION,
  };
}

function cacheIdentity(overrides: CaseVoiceCacheIdentity = {}) {
  if ("interviewerMode" in overrides && overrides.interviewerMode === "llm") {
    return { interviewer: {
      mode: "llm" as const,
      version: overrides.interviewerVersion,
      caseId: overrides.selectedCaseId,
    } };
  }
  const controller = overrides as ControllerCacheIdentity;
  return { controller: controllerIdentity(controller) };
}

export function buildCaseVoiceRequestCacheKey(
  sessionId: string,
  callId: string,
  messages: CaseTurnCacheMessage[],
  identity: CaseVoiceCacheIdentity = {},
): string {
  const materialMessages = messages.filter(
    ({ role, content }) => role !== "assistant" || content.trim().length > 0,
  );
  const digest = createHash("sha256")
    .update(JSON.stringify({
      ...cacheIdentity(identity),
      sessionId,
      callId,
      messages: materialMessages.map(({ role, content }) => ({ role, content })),
    }))
    .digest("hex");
  return `${callId}:${digest}`;
}

export function buildCaseVoiceLogicalTurnKey(
  callId: string,
  messages: CaseTurnCacheMessage[],
  candidateIndex: number,
  identity: CaseVoiceCacheIdentity = {},
): string {
  const priorContext = messages
    .slice(0, candidateIndex)
    .filter(({ role, content }) => role !== "system" && content.trim().length > 0)
    .map(({ role, content }) => ({ role, content }));
  const digest = createHash("sha256")
    .update(JSON.stringify({
      ...cacheIdentity(identity),
      candidateIndex,
      priorContext,
    }))
    .digest("hex");
  return `${callId}:${digest}`;
}
