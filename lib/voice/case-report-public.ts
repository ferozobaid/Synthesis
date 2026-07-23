export type PublicCaseReportFailureCode =
  | "insufficient_interview_data"
  | "report_generation_failed"
  | "report_unavailable";

export const PUBLIC_CASE_REPORT_FAILURE_CODES: readonly PublicCaseReportFailureCode[] = [
  "insufficient_interview_data",
  "report_generation_failed",
  "report_unavailable",
] as const;

/** Closed mapping from internal diagnostics to candidate-safe polling codes. */
export function publicCaseReportFailureCode(
  internalCode: string | null | undefined,
): PublicCaseReportFailureCode {
  if (internalCode === "empty_transcript" || internalCode === "unusable_transcript") {
    return "insufficient_interview_data";
  }
  if (
    internalCode === "report_unavailable" ||
    internalCode === "session_expired" ||
    internalCode === "report_expired"
  ) {
    return "report_unavailable";
  }
  return "report_generation_failed";
}
