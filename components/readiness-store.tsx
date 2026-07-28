"use client";

/**
 * Presentation-only readiness store.
 *
 * Carries the shared "target role" (resume + JD) and each module's latest score
 * and status so the dashboard can show one live readiness number. Backed by
 * localStorage; nothing here touches the backend or API contracts.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ModuleKey = "fit" | "behavioural" | "case";
export type ModuleStatus = "not_started" | "in_progress" | "done";
export type TargetSource = "unset" | "personalized" | "sample";

export interface ModuleResult {
  status: ModuleStatus;
  /** Normalized 0..100 score (module results are scaled into this range). */
  score: number | null;
  /** Short status line shown on the dashboard card, e.g. "3 matched · 2 gaps". */
  statusLine?: string;
  updatedAt?: number;
}

export interface Target {
  role: string | null;
  company: string | null;
  jdText: string;
  resumeText: string;
}

export type CaseOutcomeTrack = "strategy" | "technical";

/**
 * One case's accumulated result history. Keyed by caseId so a completed case can
 * show its OWN score — the single aggregate `case` module cannot identify which
 * case produced it.
 */
export interface CaseOutcome {
  caseId: string;
  caseTrack: CaseOutcomeTrack;
  /** Newest unique attempt, 0..100. Complete or partial. */
  latestScore: number | null;
  /** Best attempt under the complete-beats-partial policy (see mergeCaseOutcome). */
  bestScore: number | null;
  attemptCount: number;
  lastCompletedAt: number;
  latestWasPartial: boolean;
  /** True when bestScore came from a partial attempt — never present it as final. */
  bestWasPartial: boolean;
  latestOutcomeId: string;
  /**
   * Every outcome id already folded in, newest first and bounded. Tracking more
   * than the latest id means a late poll of an OLDER attempt is also a no-op, not
   * a phantom new attempt.
   */
  recordedOutcomeIds: string[];
}

/** How many outcome ids to remember per case before dropping the oldest. */
export const MAX_RECORDED_OUTCOME_IDS = 20;

export interface ReadinessState {
  target: Target;
  targetSource: TargetSource;
  fit: ModuleResult;
  behavioural: ModuleResult;
  case: ModuleResult;
  /** Per-case results, keyed by caseId. Both tracks live here. */
  caseOutcomes: Record<string, CaseOutcome>;
}

/** A completed, scored attempt handed to the store. */
export interface CompletedCaseOutcome {
  caseId: string;
  caseTrack: CaseOutcomeTrack;
  /** Normalized 0..100. */
  score: number;
  partial: boolean;
  outcomeId: string;
  completedAt?: number;
}

/**
 * Fold a completed attempt into a case's history.
 *
 * Returns null when this outcome id was already recorded — the caller must then
 * change nothing at all (no attempt count, no timestamps, no readiness write), so
 * repeated polling and duplicate webhook delivery are true no-ops.
 *
 * Best-score policy: a complete attempt always outranks a partial one. A higher
 * partial score never displaces a complete best, and the first complete attempt
 * becomes the best even when its number is lower than an earlier partial.
 */
export function mergeCaseOutcome(
  existing: CaseOutcome | undefined,
  incoming: CompletedCaseOutcome,
): CaseOutcome | null {
  if (existing?.recordedOutcomeIds?.includes(incoming.outcomeId)) return null;

  const completedAt = incoming.completedAt ?? Date.now();
  const hadCompleteBest = !!existing && existing.bestScore !== null && !existing.bestWasPartial;

  let bestScore: number;
  let bestWasPartial: boolean;
  if (!incoming.partial) {
    // A complete attempt supersedes any partial best outright; against another
    // complete best it competes on score.
    bestScore = hadCompleteBest
      ? Math.max(existing!.bestScore!, incoming.score)
      : incoming.score;
    bestWasPartial = false;
  } else if (hadCompleteBest) {
    // A partial can never displace a complete best, however high it scores.
    bestScore = existing!.bestScore!;
    bestWasPartial = false;
  } else {
    bestScore = Math.max(existing?.bestScore ?? Number.NEGATIVE_INFINITY, incoming.score);
    bestWasPartial = true;
  }

  return {
    caseId: incoming.caseId,
    caseTrack: incoming.caseTrack,
    latestScore: incoming.score,
    bestScore,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastCompletedAt: completedAt,
    latestWasPartial: incoming.partial,
    bestWasPartial,
    latestOutcomeId: incoming.outcomeId,
    recordedOutcomeIds: [
      incoming.outcomeId,
      ...(existing?.recordedOutcomeIds ?? []),
    ].slice(0, MAX_RECORDED_OUTCOME_IDS),
  };
}

/** Dashboard status line for the Case module, marking a provisional latest result. */
export function caseReadinessStatusLine(outcome: CaseOutcome): string {
  const attempts = `${outcome.attemptCount} case${outcome.attemptCount === 1 ? "" : "s"}`;
  return outcome.latestWasPartial
    ? `${attempts} · provisional (partial report)`
    : `${attempts} · full report`;
}

const EMPTY_MODULE: ModuleResult = { status: "not_started", score: null };

export const DEFAULT_READINESS_STATE: ReadinessState = {
  target: { role: null, company: null, jdText: "", resumeText: "" },
  targetSource: "unset",
  fit: EMPTY_MODULE,
  behavioural: EMPTY_MODULE,
  case: EMPTY_MODULE,
  caseOutcomes: {},
};

const STORAGE_KEY = "synthesis-readiness";

interface ReadinessContextValue {
  state: ReadinessState;
  hydrated: boolean;
  setTarget: (patch: Partial<Target>) => void;
  /**
   * Commit a full target (from onboarding). If any material field changed,
   * existing module results are invalidated so the dashboard returns to an
   * unstarted state for the new role.
   */
  commitTarget: (
    next: Target,
    source: Exclude<TargetSource, "unset">,
  ) => void;
  setModule: (key: ModuleKey, patch: Partial<ModuleResult>) => void;
  /**
   * The single entry point for a completed case. Idempotent by outcomeId, and the
   * only place that decides whether a result also moves Case readiness (Strategy
   * does; Technical never does).
   */
  recordCaseOutcome: (outcome: CompletedCaseOutcome) => void;
  reset: () => void;
  seedSample: () => void;
  overallReadiness: () => number | null;
  nextBestAction: () => NextAction;
}

export interface NextAction {
  title: string;
  desc: string;
  cta: string;
  href: string;
}

const ReadinessContext = createContext<ReadinessContextValue | null>(null);

// A representative candidate used for "See a sample" / "Try a sample candidate".
export const SAMPLE_TARGET: Target = {
  role: "Data Analyst",
  company: "Tenazx Inc",
  resumeText: `JANE DOE
Business Analytics · jane.doe@email.com

SUMMARY
Commercial analyst with 3 years turning messy data into decisions.

EXPERIENCE
Commercial Analyst, Retail Co
- Built outlet-level reporting in SQL across 4 regions
- Automated monthly analysis in Python (pandas), cutting prep time ~6 hrs/week
- Designed Power BI dashboards used in regional sales reviews

EDUCATION
BSc, Business Analytics`,
    jdText: `Title: Data Analyst
Company: Tenazx Inc

We are hiring a Data Analyst. Required: strong SQL and Python or R; experience with
data visualization tools; statistical analysis. A Bachelor's degree in a quantitative
field is required. Experience with cybersecurity or financial services is a plus.`,
};

export const SAMPLE_READINESS_STATE: ReadinessState = {
  target: SAMPLE_TARGET,
  targetSource: "sample",
  fit: EMPTY_MODULE,
  behavioural: EMPTY_MODULE,
  case: EMPTY_MODULE,
  caseOutcomes: {},
};

function normalized(value: string | null): string {
  return (value ?? "").trim();
}

function targetsMatch(left: Target, right: Target): boolean {
  return (
    normalized(left.role) === normalized(right.role) &&
    normalized(left.company) === normalized(right.company) &&
    normalized(left.jdText) === normalized(right.jdText) &&
    normalized(left.resumeText) === normalized(right.resumeText)
  );
}

function hasAnyTargetValue(target: Target): boolean {
  return Object.values(target).some((value) => normalized(value).length > 0);
}

export function hasCompleteTarget(
  state: Pick<ReadinessState, "target" | "targetSource">,
): boolean {
  return (
    state.targetSource !== "unset" &&
    normalized(state.target.role).length > 0 &&
    normalized(state.target.jdText).length > 0
  );
}

export function inferLegacyTargetSource(target: Target): TargetSource {
  if (targetsMatch(target, SAMPLE_TARGET)) return "sample";
  return hasAnyTargetValue(target) ? "personalized" : "unset";
}

function isTargetSource(value: unknown): value is TargetSource {
  return (
    value === "unset" ||
    value === "personalized" ||
    value === "sample"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hydrateModule(value: unknown): ModuleResult {
  if (!isRecord(value)) return { ...EMPTY_MODULE };
  const status =
    value.status === "not_started" ||
    value.status === "in_progress" ||
    value.status === "done"
      ? value.status
      : "not_started";
  return {
    status,
    score:
      typeof value.score === "number" || value.score === null
        ? value.score
        : null,
    statusLine:
      typeof value.statusLine === "string" ? value.statusLine : undefined,
    updatedAt:
      typeof value.updatedAt === "number" ? value.updatedAt : undefined,
  };
}

/**
 * Rebuild the per-case outcome map field by field. A legacy blob with no
 * `caseOutcomes` key yields {} — it must never disturb the Fit, Behavioural, or
 * Case module results stored alongside it. Any individual entry that fails
 * validation is dropped rather than poisoning the whole map.
 */
export function hydrateCaseOutcomes(value: unknown): Record<string, CaseOutcome> {
  if (!isRecord(value)) return {};
  const outcomes: Record<string, CaseOutcome> = {};
  for (const [caseId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    if (typeof raw.caseId !== "string" || !raw.caseId) continue;
    if (raw.caseTrack !== "strategy" && raw.caseTrack !== "technical") continue;
    if (typeof raw.latestOutcomeId !== "string" || !raw.latestOutcomeId) continue;
    if (typeof raw.attemptCount !== "number" || !Number.isFinite(raw.attemptCount)) continue;
    const numberOrNull = (input: unknown): number | null =>
      typeof input === "number" && Number.isFinite(input) ? input : null;
    outcomes[caseId] = {
      caseId: raw.caseId,
      caseTrack: raw.caseTrack,
      latestScore: numberOrNull(raw.latestScore),
      bestScore: numberOrNull(raw.bestScore),
      attemptCount: raw.attemptCount,
      lastCompletedAt: numberOrNull(raw.lastCompletedAt) ?? 0,
      latestWasPartial: raw.latestWasPartial === true,
      bestWasPartial: raw.bestWasPartial === true,
      latestOutcomeId: raw.latestOutcomeId,
      recordedOutcomeIds: Array.isArray(raw.recordedOutcomeIds)
        ? raw.recordedOutcomeIds
            .filter((id): id is string => typeof id === "string" && id.length > 0)
            .slice(0, MAX_RECORDED_OUTCOME_IDS)
        : [raw.latestOutcomeId],
    };
  }
  return outcomes;
}

export function hydrateReadinessState(value: unknown): ReadinessState {
  const parsed = isRecord(value) ? value : {};
  const parsedTarget = isRecord(parsed.target) ? parsed.target : {};
  const target: Target = {
    role:
      typeof parsedTarget.role === "string" || parsedTarget.role === null
        ? parsedTarget.role
        : null,
    company:
      typeof parsedTarget.company === "string" ||
      parsedTarget.company === null
        ? parsedTarget.company
        : null,
    jdText:
      typeof parsedTarget.jdText === "string" ? parsedTarget.jdText : "",
    resumeText:
      typeof parsedTarget.resumeText === "string"
        ? parsedTarget.resumeText
        : "",
  };

  return {
    target,
    targetSource: isTargetSource(parsed.targetSource)
      ? parsed.targetSource
      : inferLegacyTargetSource(target),
    fit: hydrateModule(parsed.fit),
    behavioural: hydrateModule(parsed.behavioural),
    case: hydrateModule(parsed.case),
    caseOutcomes: hydrateCaseOutcomes(parsed.caseOutcomes),
  };
}

export function commitReadinessTarget(
  current: ReadinessState,
  next: Target,
  source: Exclude<TargetSource, "unset">,
): ReadinessState {
  if (targetsMatch(current.target, next)) {
    return { ...current, target: { ...current.target, ...next }, targetSource: source };
  }
  return {
    ...DEFAULT_READINESS_STATE,
    target: next,
    targetSource: source,
  };
}

export function buildPersonalizedTarget(
  current: Pick<ReadinessState, "target" | "targetSource">,
  role: Omit<Target, "resumeText">,
): Target {
  const hasBundledSampleResume =
    current.targetSource === "sample" &&
    normalized(current.target.resumeText) ===
      normalized(SAMPLE_TARGET.resumeText);
  return {
    ...role,
    resumeText: hasBundledSampleResume ? "" : current.target.resumeText,
  };
}

export function ReadinessProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ReadinessState>(DEFAULT_READINESS_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once on mount (client only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState(hydrateReadinessState(JSON.parse(raw)));
      }
    } catch {
      /* ignore malformed storage */
    }
    setHydrated(true);
  }, []);

  // Persist on change (after hydration to avoid clobbering).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage may be unavailable */
    }
  }, [state, hydrated]);

  const setTarget = useCallback((patch: Partial<Target>) => {
    setState((s) => ({ ...s, target: { ...s.target, ...patch } }));
  }, []);

  const commitTarget = useCallback(
    (next: Target, source: Exclude<TargetSource, "unset">) => {
      setState((current) => commitReadinessTarget(current, next, source));
    },
    [],
  );

  const setModule = useCallback((key: ModuleKey, patch: Partial<ModuleResult>) => {
    setState((s) => ({
      ...s,
      [key]: { ...s[key], ...patch, updatedAt: Date.now() },
    }));
  }, []);

  const recordCaseOutcome = useCallback((outcome: CompletedCaseOutcome) => {
    setState((s) => {
      const merged = mergeCaseOutcome(s.caseOutcomes[outcome.caseId], outcome);
      // Already recorded: change nothing — not the map, not the timestamps, and
      // not Case readiness. Returning the identical state also avoids a re-render.
      if (!merged) return s;
      const next: ReadinessState = {
        ...s,
        caseOutcomes: { ...s.caseOutcomes, [outcome.caseId]: merged },
      };
      // Technical rounds are recorded but never move Strategy/Case readiness.
      if (merged.caseTrack !== "strategy") return next;
      return {
        ...next,
        case: {
          ...next.case,
          status: "done",
          // Existing scale and conventions: the latest unique scored attempt,
          // already normalized to 0..100. No averaging or new formula.
          score: merged.latestScore,
          statusLine: caseReadinessStatusLine(merged),
          updatedAt: merged.lastCompletedAt,
        },
      };
    });
  }, []);

  const reset = useCallback(() => setState(DEFAULT_READINESS_STATE), []);
  const seedSample = useCallback(() => setState(SAMPLE_READINESS_STATE), []);

  const overallReadiness = useCallback((): number | null => {
    const parts = [state.fit, state.behavioural, state.case].filter(
      (m) => m.score != null,
    ) as Required<ModuleResult>[];
    if (parts.length === 0) return null;
    const sum = parts.reduce((acc, m) => acc + (m.score ?? 0), 0);
    return Math.round(sum / parts.length);
  }, [state]);

  const nextBestAction = useCallback((): NextAction => {
    const { fit, behavioural, case: caseM } = state;
    if (!hasCompleteTarget(state))
      return {
        title: "Set the role you're preparing for",
        desc: "Add the target job once so fit, behavioural, and case practice share the same benchmark.",
        cta: "Set target role",
        href: "/onboard",
      };
    // Prioritize the not-yet-run module, then the weakest completed one.
    if (fit.status === "not_started")
      return {
        title: "Diagnose your resume fit first",
        desc: "See exactly where you match the role and what to close before you rehearse.",
        cta: "Analyze fit",
        href: "/fit",
      };
    if (behavioural.status === "not_started")
      return {
        title: "Rehearse your behavioural answers",
        desc: "Practice real questions with a STAR scaffold and get scored coaching on each.",
        cta: "Rehearse",
        href: "/behavioural",
      };
    if (caseM.status === "not_started")
      return {
        title: "Drill a live case interview",
        desc: "Work an adaptive case end to end — exhibits, pressure tests, and a scored report.",
        cta: "Drill a case",
        href: "/case",
      };
    // All started: point at the weakest.
    const ranked = (
      [
        ["fit", fit, "/fit", "Sharpen your fit"],
        ["behavioural", behavioural, "/behavioural", "Rehearse weaker answers"],
        ["case", caseM, "/case", "Run another case"],
      ] as const
    )
      .filter(([, m]) => m.score != null)
      .sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0));
    const weakest = ranked[0];
    if (weakest) {
      return {
        title: `${weakest[3]} to lift your readiness`,
        desc: "This is currently your lowest-scoring module — the fastest way to raise your overall score.",
        cta: "Open module",
        href: weakest[2],
      };
    }
    return {
      title: "You're interview-ready",
      desc: "All three modules are strong. Do a final pass on anything that still feels shaky.",
      cta: "Review dashboard",
      href: "/dashboard",
    };
  }, [state]);

  const value = useMemo<ReadinessContextValue>(
    () => ({
      state,
      hydrated,
      setTarget,
      commitTarget,
      setModule,
      recordCaseOutcome,
      reset,
      seedSample,
      overallReadiness,
      nextBestAction,
    }),
    [state, hydrated, setTarget, commitTarget, setModule, recordCaseOutcome, reset, seedSample, overallReadiness, nextBestAction],
  );

  return <ReadinessContext.Provider value={value}>{children}</ReadinessContext.Provider>;
}

export function useReadiness(): ReadinessContextValue {
  const ctx = useContext(ReadinessContext);
  if (!ctx) throw new Error("useReadiness must be used within ReadinessProvider");
  return ctx;
}
