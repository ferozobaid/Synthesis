import { CASE_VOICE_CONTROLLER_VERSION } from "@/lib/voice/case-turn-plan";

export type CaseVoiceInterviewerMode = "legacy" | "llm";

export const CASE_VOICE_LLM_VERSION = "case-voice-llm-v2";

export interface CaseVoiceInterviewerSnapshot {
  mode: CaseVoiceInterviewerMode;
  version: string;
}

interface ModeEnvironment {
  CASE_VOICE_INTERVIEWER_MODE?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}

/** LLM mode is fail-closed to Vercel Preview and tests. */
export function resolveCaseVoiceInterviewerMode(
  env: ModeEnvironment = process.env,
): CaseVoiceInterviewerMode {
  if (env.VERCEL_ENV === "production") return "legacy";
  if (env.CASE_VOICE_INTERVIEWER_MODE?.trim().toLowerCase() !== "llm") return "legacy";
  return env.VERCEL_ENV === "preview" || env.NODE_ENV === "test" ? "llm" : "legacy";
}

export function newCaseVoiceInterviewerSnapshot(
  env: ModeEnvironment = process.env,
): CaseVoiceInterviewerSnapshot {
  const mode = resolveCaseVoiceInterviewerMode(env);
  return {
    mode,
    version: mode === "llm" ? CASE_VOICE_LLM_VERSION : CASE_VOICE_CONTROLLER_VERSION,
  };
}

/** Missing snapshot fields identify sessions created by the legacy architecture. */
export function storedCaseVoiceInterviewerSnapshot(session: {
  interviewerMode?: CaseVoiceInterviewerMode;
  interviewerVersion?: string;
}): CaseVoiceInterviewerSnapshot {
  if (session.interviewerMode === "llm") {
    return {
      mode: "llm",
      version: session.interviewerVersion || CASE_VOICE_LLM_VERSION,
    };
  }
  return {
    mode: "legacy",
    version: session.interviewerVersion || CASE_VOICE_CONTROLLER_VERSION,
  };
}
