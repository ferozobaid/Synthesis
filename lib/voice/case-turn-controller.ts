import { complete } from "@/lib/claude";
import { useMocks } from "@/lib/config";
import type { CaseState } from "@/lib/types";
import {
  CASE_TURN_CONTROLLER_INTENTS,
  parseCaseTurnControllerDecision,
  type CaseTurnControllerDecision,
  type CaseVoiceControllerMode,
} from "@/lib/voice/case-turn-plan";

export const CASE_TURN_CONTROLLER_MODEL = "claude-haiku-4-5-20251001";
export const CASE_TURN_CONTROLLER_MAX_TOKENS = 256;
export const CASE_TURN_CONTROLLER_TIMEOUT_MS = 2_500;
export const CASE_TURN_CONTROLLER_MAX_RETRIES = 0;

export const CASE_TURN_CONTROLLER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: [...CASE_TURN_CONTROLLER_INTENTS] },
    targetStage: {
      anyOf: [
        {
          type: "string",
          enum: [
            "intro",
            "clarification",
            "framework",
            "analysis",
            "data_reveal",
            "pressure_test",
            "recommendation",
            "scoring",
          ],
        },
        { type: "null" },
      ],
    },
    shouldEvaluate: { type: "boolean" },
    substantiveRemainder: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "intent",
    "targetStage",
    "shouldEvaluate",
    "substantiveRemainder",
    "confidence",
  ],
} as const;

export interface CaseTurnControllerInput {
  readinessStatus: "awaiting" | "confirmed";
  conversationStatus: "active" | "paused";
  currentStage: CaseState;
  candidateText: string;
  currentInterviewerPrompt: string;
  recentTurns: Array<{ candidateText: string; interviewerText: string }>;
  lastProbeObjective: { id: string; prompt: string } | null;
  immediateLegalNextStage: CaseState | null;
  clarificationTopics: string[];
  caseId: string;
}

export type CaseTurnControllerOutcome =
  | "success"
  | "timeout"
  | "refusal"
  | "invalid_json"
  | "schema_mismatch"
  | "error";

export interface CaseTurnControllerResult {
  outcome: CaseTurnControllerOutcome;
  decision: CaseTurnControllerDecision | null;
  durationMs: number;
}

type CompleteController = typeof complete;
let mockModeWarningEmitted = false;

export function warnIfCaseTurnControllerUsesMocks(
  mode: CaseVoiceControllerMode,
  mockMode = useMocks(),
): void {
  if (mode === "off" || !mockMode || mockModeWarningEmitted) return;
  mockModeWarningEmitted = true;
  console.warn(
    "[case-custom-llm] bounded controller is enabled while Claude mocks are active; ambiguous turns will fail closed",
  );
}

const SYSTEM_PROMPT = [
  "You classify one finalized candidate utterance for a server-owned case interview.",
  "Return only the required JSON object. Do not write interviewer speech, facts, scores, exhibits, or questions.",
  "The server validates all transitions and remains authoritative.",
  "For mixed language, precedence is: explicit end; final explicit pause/thinking request; repeat; stage navigation; frustration/confusion; clarification question; substantive answer.",
  "The final explicit actionable clause dominates conflicting earlier language.",
  "For stage_transition_with_answer, substantive_answer, self_correction, or clarification_question, copy substantiveRemainder verbatim from the candidate utterance.",
  "For every other intent, substantiveRemainder must be an empty string.",
  "Never classify frustration, requests to stop repetition, or discussion of stopping a rollout as end_interview.",
].join(" ");

function promptFor(input: CaseTurnControllerInput): string {
  return JSON.stringify({
    task: "Classify conversational intent only",
    readinessStatus: input.readinessStatus,
    conversationStatus: input.conversationStatus,
    currentStage: input.currentStage,
    candidateUtterance: input.candidateText,
    currentInterviewerPrompt: input.currentInterviewerPrompt,
    recentCanonicalTurns: input.recentTurns.slice(-2),
    lastProbeObjective: input.lastProbeObjective,
    immediateLegalNextStage: input.immediateLegalNextStage,
    allowedIntents: CASE_TURN_CONTROLLER_INTENTS,
    clarificationTopics: input.clarificationTopics,
    caseId: input.caseId,
  });
}

function timeoutError(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown } | null;
  return /timeout/i.test(String(candidate?.name ?? "")) || /timed? out|timeout/i.test(String(candidate?.message ?? ""));
}

function refusalText(text: string): boolean {
  return /^(?:i(?:'m| am) sorry|i cannot|i can'?t|unable to|refus)/i.test(text.trim());
}

export async function runCaseTurnController(
  input: CaseTurnControllerInput,
  completeController: CompleteController = complete,
): Promise<CaseTurnControllerResult> {
  const startedAt = Date.now();
  try {
    const text = await completeController(promptFor(input), {
      system: SYSTEM_PROMPT,
      model: CASE_TURN_CONTROLLER_MODEL,
      temperature: 0,
      maxTokens: CASE_TURN_CONTROLLER_MAX_TOKENS,
      timeoutMs: CASE_TURN_CONTROLLER_TIMEOUT_MS,
      maxRetries: CASE_TURN_CONTROLLER_MAX_RETRIES,
      outputSchema: CASE_TURN_CONTROLLER_SCHEMA,
    });
    if (refusalText(text)) {
      return { outcome: "refusal", decision: null, durationMs: Date.now() - startedAt };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { outcome: "invalid_json", decision: null, durationMs: Date.now() - startedAt };
    }
    const decision = parseCaseTurnControllerDecision(parsed);
    return decision
      ? { outcome: "success", decision, durationMs: Date.now() - startedAt }
      : { outcome: "schema_mismatch", decision: null, durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      outcome: timeoutError(error) ? "timeout" : "error",
      decision: null,
      durationMs: Date.now() - startedAt,
    };
  }
}
