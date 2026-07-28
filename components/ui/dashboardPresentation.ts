import type { ModuleResult } from "@/components/readiness-store";

export function isProvisionalCaseResult(module: ModuleResult): boolean {
  return (
    module.status === "done" &&
    module.score !== null &&
    /\bprovisional\b/i.test(module.statusLine ?? "")
  );
}
