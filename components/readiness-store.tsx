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

export interface ReadinessState {
  target: Target;
  fit: ModuleResult;
  behavioural: ModuleResult;
  case: ModuleResult;
}

const EMPTY_MODULE: ModuleResult = { status: "not_started", score: null };

const DEFAULT_STATE: ReadinessState = {
  target: { role: null, company: null, jdText: "", resumeText: "" },
  fit: EMPTY_MODULE,
  behavioural: EMPTY_MODULE,
  case: EMPTY_MODULE,
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
  commitTarget: (next: Target) => void;
  setModule: (key: ModuleKey, patch: Partial<ModuleResult>) => void;
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
const SAMPLE_STATE: ReadinessState = {
  target: {
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
  },
  fit: EMPTY_MODULE,
  behavioural: EMPTY_MODULE,
  case: EMPTY_MODULE,
};

export function ReadinessProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ReadinessState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once on mount (client only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ReadinessState>;
        setState({ ...DEFAULT_STATE, ...parsed, target: { ...DEFAULT_STATE.target, ...parsed.target } });
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

  const commitTarget = useCallback((next: Target) => {
    setState((s) => {
      const cur = s.target;
      const norm = (v: string | null) => (v ?? "").trim();
      const changed =
        norm(next.role) !== norm(cur.role) ||
        norm(next.company) !== norm(cur.company) ||
        norm(next.jdText) !== norm(cur.jdText) ||
        norm(next.resumeText) !== norm(cur.resumeText);
      // Unchanged target: keep module results. Materially different target:
      // reset every module so readiness reflects the new role, not the old one.
      if (!changed) return { ...s, target: { ...cur, ...next } };
      return { ...DEFAULT_STATE, target: next };
    });
  }, []);

  const setModule = useCallback((key: ModuleKey, patch: Partial<ModuleResult>) => {
    setState((s) => ({
      ...s,
      [key]: { ...s[key], ...patch, updatedAt: Date.now() },
    }));
  }, []);

  const reset = useCallback(() => setState(DEFAULT_STATE), []);
  const seedSample = useCallback(() => setState(SAMPLE_STATE), []);

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
      reset,
      seedSample,
      overallReadiness,
      nextBestAction,
    }),
    [state, hydrated, setTarget, commitTarget, setModule, reset, seedSample, overallReadiness, nextBestAction],
  );

  return <ReadinessContext.Provider value={value}>{children}</ReadinessContext.Provider>;
}

export function useReadiness(): ReadinessContextValue {
  const ctx = useContext(ReadinessContext);
  if (!ctx) throw new Error("useReadiness must be used within ReadinessProvider");
  return ctx;
}
