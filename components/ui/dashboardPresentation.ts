import type {
  InterviewReadinessSource,
  ModuleResult,
} from "@/components/readiness-store";

export function isProvisionalCaseResult(module: ModuleResult): boolean {
  return (
    module.status === "done" &&
    module.score !== null &&
    /\bprovisional\b/i.test(module.statusLine ?? "")
  );
}

const INTERVIEW_SOURCE_COPY: Record<
  InterviewReadinessSource["kind"],
  string
> = {
  strategy: "Based on your latest Strategy case",
  data_analyst_technical:
    "Based on your latest Data Analyst technical interview",
  data_engineer_technical:
    "Based on your latest Data Engineer technical interview",
  clickstream_system_design:
    "Based on your latest Clickstream system-design interview",
  technical: "Based on your latest technical interview",
};

export function interviewReadinessSourceCopy(
  source: InterviewReadinessSource | null,
): string {
  return source ? INTERVIEW_SOURCE_COPY[source.kind] : "Interview source pending";
}
