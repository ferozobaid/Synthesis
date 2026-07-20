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

function controllerIdentity(overrides: ControllerCacheIdentity = {}) {
  return {
    mode: overrides.mode ?? caseVoiceControllerMode(),
    version: overrides.version ?? CASE_VOICE_CONTROLLER_VERSION,
  };
}

export function buildCaseVoiceRequestCacheKey(
  sessionId: string,
  callId: string,
  messages: CaseTurnCacheMessage[],
  controller: ControllerCacheIdentity = {},
): string {
  const materialMessages = messages.filter(
    ({ role, content }) => role !== "assistant" || content.trim().length > 0,
  );
  const digest = createHash("sha256")
    .update(JSON.stringify({
      controller: controllerIdentity(controller),
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
  controller: ControllerCacheIdentity = {},
): string {
  const priorContext = messages
    .slice(0, candidateIndex)
    .filter(({ role, content }) => role !== "system" && content.trim().length > 0)
    .map(({ role, content }) => ({ role, content }));
  const digest = createHash("sha256")
    .update(JSON.stringify({
      controller: controllerIdentity(controller),
      candidateIndex,
      priorContext,
    }))
    .digest("hex");
  return `${callId}:${digest}`;
}
