export type CaseVoiceArchitecture = "custom_llm" | "vapi_native";

export const CASE_VOICE_CUSTOM_ORCHESTRATION_VERSION = "case-voice-custom-llm-v2";
export const CASE_VOICE_NATIVE_ORCHESTRATION_VERSION = "case-voice-vapi-native-v1";
export const CASE_VOICE_STAGE_ANCHOR_VERSION = "case-stage-anchors-v1";
/** Anchor manifest version for the per-question technical rounds (question-level mapping). */
export const CASE_VOICE_QUESTION_ANCHOR_VERSION = "technical-question-anchors-v1";

/** Case ids that resolve through a dedicated native Vapi assistant. */
export type NativeCaseId =
  | "airport_profitability"
  | "gcc_premium_gym_market_entry"
  | "data_engineer_clickstream"
  | "data_analyst_technical_round"
  | "data_engineer_technical_round";

/** Native rounds that run one dedicated assistant conducting a fixed question bank. */
export const QUESTION_BANK_NATIVE_CASE_IDS = [
  "data_analyst_technical_round",
  "data_engineer_technical_round",
] as const;

export interface CaseNativeAssistantConfig {
  caseId: NativeCaseId;
  assistantId: string;
  assistantConfigVersion: string;
  /** Anchor manifest version: stage anchors for cases, question anchors for rounds. */
  stageAnchorVersion: string;
}

interface NativeEnvironment {
  [key: string]: string | undefined;
  CASE_VOICE_ARCHITECTURE?: string;
  VAPI_AIRPORT_ASSISTANT_ID?: string;
  VAPI_GCC_GYM_ASSISTANT_ID?: string;
  VAPI_DATA_ENGINEER_ASSISTANT_ID?: string;
  VAPI_DATA_ANALYST_TECHNICAL_ROUND_ASSISTANT_ID?: string;
  VAPI_DATA_ENGINEER_TECHNICAL_ROUND_ASSISTANT_ID?: string;
}

const STATIC_CONFIG = {
  airport_profitability: {
    envKey: "VAPI_AIRPORT_ASSISTANT_ID",
    assistantConfigVersion: "airport-profitability-assistant-v1",
    anchorVersion: CASE_VOICE_STAGE_ANCHOR_VERSION,
  },
  gcc_premium_gym_market_entry: {
    envKey: "VAPI_GCC_GYM_ASSISTANT_ID",
    assistantConfigVersion: "gcc-premium-gym-assistant-v1",
    anchorVersion: CASE_VOICE_STAGE_ANCHOR_VERSION,
  },
  data_engineer_clickstream: {
    envKey: "VAPI_DATA_ENGINEER_ASSISTANT_ID",
    assistantConfigVersion: "data-engineer-clickstream-assistant-v1",
    anchorVersion: CASE_VOICE_STAGE_ANCHOR_VERSION,
  },
  data_analyst_technical_round: {
    envKey: "VAPI_DATA_ANALYST_TECHNICAL_ROUND_ASSISTANT_ID",
    assistantConfigVersion: "data-analyst-technical-round-assistant-v1",
    anchorVersion: CASE_VOICE_QUESTION_ANCHOR_VERSION,
  },
  data_engineer_technical_round: {
    envKey: "VAPI_DATA_ENGINEER_TECHNICAL_ROUND_ASSISTANT_ID",
    assistantConfigVersion: "data-engineer-technical-round-assistant-v1",
    anchorVersion: CASE_VOICE_QUESTION_ANCHOR_VERSION,
  },
} as const;

export function resolveCaseVoiceArchitecture(
  env: NativeEnvironment = process.env,
): CaseVoiceArchitecture {
  return env.CASE_VOICE_ARCHITECTURE?.trim().toLowerCase() === "vapi_native"
    ? "vapi_native"
    : "custom_llm";
}

/** Per-case architecture resolution: forced cases win; everything else falls back unchanged. */
export function resolveCaseVoiceArchitectureForCase(
  caseId: string,
  env: NativeEnvironment = process.env,
): CaseVoiceArchitecture {
  // Clickstream may use its dedicated native assistant when one is configured,
  // but it must remain startable through the authored custom-LLM Case transport
  // when that optional deployment-specific id is absent.
  if (caseId === "data_engineer_clickstream") {
    return resolveNativeCaseAssistant(caseId, env) ? "vapi_native" : "custom_llm";
  }
  // The technical rounds are native-only: they have no authored custom-LLM
  // transport. They always resolve vapi_native so an unconfigured assistant id
  // fails closed at session bootstrap (503 native_assistant_not_configured)
  // rather than falling back to a broken custom-LLM start.
  if ((QUESTION_BANK_NATIVE_CASE_IDS as readonly string[]).includes(caseId)) {
    return "vapi_native";
  }
  return resolveCaseVoiceArchitecture(env);
}

export function storedCaseVoiceArchitecture(session: {
  architecture?: CaseVoiceArchitecture;
}): CaseVoiceArchitecture {
  return session.architecture === "vapi_native" ? "vapi_native" : "custom_llm";
}

export function caseVoiceOrchestrationVersion(architecture: CaseVoiceArchitecture): string {
  return architecture === "vapi_native"
    ? CASE_VOICE_NATIVE_ORCHESTRATION_VERSION
    : CASE_VOICE_CUSTOM_ORCHESTRATION_VERSION;
}

export function resolveNativeCaseAssistant(
  caseId: string,
  env: NativeEnvironment = process.env,
): CaseNativeAssistantConfig | null {
  if (!Object.prototype.hasOwnProperty.call(STATIC_CONFIG, caseId)) return null;
  const staticConfig = STATIC_CONFIG[caseId as keyof typeof STATIC_CONFIG];
  const assistantId = env[staticConfig.envKey]?.trim();
  if (!assistantId) return null;
  return {
    caseId: caseId as CaseNativeAssistantConfig["caseId"],
    assistantId,
    assistantConfigVersion: staticConfig.assistantConfigVersion,
    stageAnchorVersion: staticConfig.anchorVersion,
  };
}
