export type CaseVoiceArchitecture = "custom_llm" | "vapi_native";

export const CASE_VOICE_CUSTOM_ORCHESTRATION_VERSION = "case-voice-custom-llm-v2";
export const CASE_VOICE_NATIVE_ORCHESTRATION_VERSION = "case-voice-vapi-native-v1";
export const CASE_VOICE_STAGE_ANCHOR_VERSION = "case-stage-anchors-v1";

export interface CaseNativeAssistantConfig {
  caseId:
    | "airport_profitability"
    | "gcc_premium_gym_market_entry"
    | "data_engineer_clickstream";
  assistantId: string;
  assistantConfigVersion: string;
  stageAnchorVersion: typeof CASE_VOICE_STAGE_ANCHOR_VERSION;
}

interface NativeEnvironment {
  [key: string]: string | undefined;
  CASE_VOICE_ARCHITECTURE?: string;
  VAPI_AIRPORT_ASSISTANT_ID?: string;
  VAPI_GCC_GYM_ASSISTANT_ID?: string;
  VAPI_DATA_ENGINEER_ASSISTANT_ID?: string;
}

const STATIC_CONFIG = {
  airport_profitability: {
    envKey: "VAPI_AIRPORT_ASSISTANT_ID",
    assistantConfigVersion: "airport-profitability-assistant-v1",
  },
  gcc_premium_gym_market_entry: {
    envKey: "VAPI_GCC_GYM_ASSISTANT_ID",
    assistantConfigVersion: "gcc-premium-gym-assistant-v1",
  },
  data_engineer_clickstream: {
    envKey: "VAPI_DATA_ENGINEER_ASSISTANT_ID",
    assistantConfigVersion: "data-engineer-clickstream-assistant-v1",
  },
} as const;

/**
 * Cases with no custom_llm interview content at all (Data Engineer ships
 * native-only) always resolve to vapi_native, regardless of the deployment-wide
 * CASE_VOICE_ARCHITECTURE flag. This is deliberately per-case and additive: it
 * leaves resolveCaseVoiceArchitecture() — and therefore Airport/GCC's existing
 * global-flag behavior — completely unchanged.
 */
const CASE_FORCED_ARCHITECTURE: Readonly<Partial<Record<string, CaseVoiceArchitecture>>> = {
  data_engineer_clickstream: "vapi_native",
};

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
  return CASE_FORCED_ARCHITECTURE[caseId] ?? resolveCaseVoiceArchitecture(env);
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
    stageAnchorVersion: CASE_VOICE_STAGE_ANCHOR_VERSION,
  };
}
