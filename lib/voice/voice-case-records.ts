import airportProfitability from "@/context/cases/airport-profitability.json";
import gccPremiumGym from "@/context/cases/gcc-premium-gym.json";
import { mockCase } from "@/lib/__mocks__/fixtures";
import type { CaseRecord } from "@/lib/types";

/**
 * Closed registry of the Preview LLM voice cases.
 *
 * These records are deliberately kept OUT of the shared mockCase() registry so
 * the manual /api/case route (which resolves through mockCase) can never load
 * them. mockCase() stays limited to beautify + diconsa; the two new cases are
 * only reachable through the voice routes via this module.
 */
const VOICE_LLM_CASE_RECORDS: Readonly<Record<string, CaseRecord>> = {
  airport_profitability: airportProfitability as unknown as CaseRecord,
  gcc_premium_gym_market_entry: gccPremiumGym as unknown as CaseRecord,
};

/** Resolve one of the LLM-only voice cases. Unknown ids fail closed. */
export function getVoiceLlmCaseRecord(caseId: string): CaseRecord | undefined {
  return Object.prototype.hasOwnProperty.call(VOICE_LLM_CASE_RECORDS, caseId)
    ? VOICE_LLM_CASE_RECORDS[caseId]
    : undefined;
}

/**
 * Resolve records needed by Case Voice: the two active Preview LLM cases plus
 * Beautify solely for old-session projection/retirement compatibility. Beautify
 * is not an active voice case. Diconsa and unknown ids remain unreachable.
 */
export function voiceCaseRecord(caseId: string): CaseRecord | undefined {
  return (
    getVoiceLlmCaseRecord(caseId) ??
    (caseId === "beautify" ? mockCase("beautify") : undefined)
  );
}
