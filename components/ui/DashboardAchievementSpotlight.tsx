"use client";

import { useEffect, useRef, useState } from "react";
import type {
  InterviewReadinessSource,
  ModuleResult,
} from "@/components/readiness-store";
import { ReadinessRing } from "@/components/ui/ReadinessRing";
import {
  interviewReadinessSourceCopy,
  isProvisionalCaseResult,
} from "@/components/ui/dashboardPresentation";

interface SpotlightBand {
  label: string;
  color: string;
  tintBg: string;
}

export interface DashboardAchievementSpotlightProps {
  open: boolean;
  overall: number | null;
  band: SpotlightBand | null;
  fit: ModuleResult;
  behavioural: ModuleResult;
  interview: ModuleResult;
  interviewSource: InterviewReadinessSource | null;
  modulesDone: number;
  role: string;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

type SpotlightView = "overall" | "fit" | "behavioural" | "interview";

export function DashboardAchievementSpotlight({
  open,
  overall,
  band,
  fit,
  behavioural,
  interview,
  interviewSource,
  modulesDone,
  role,
  onClose,
}: DashboardAchievementSpotlightProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [activeView, setActiveView] = useState<SpotlightView | null>(null);
  const provisional =
    interviewSource?.provisional ?? isProvisionalCaseResult(interview);
  const sourceCopy = interviewReadinessSourceCopy(interviewSource);
  const interviewState =
    interview.score == null ? "Pending" : provisional ? "Provisional" : "Complete";
  const activeDetail = spotlightViewDetail({
    activeView,
    overall,
    band,
    fit,
    behavioural,
    interview,
    interviewState,
    modulesDone,
    sourceCopy,
  });

  useEffect(() => {
    if (!open) return;

    setActiveView(null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => closeRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.tabIndex >= 0);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <div
      className="dashboard-spotlight"
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="dashboard-spotlight__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-spotlight-title"
        aria-describedby="dashboard-spotlight-summary"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dashboard-spotlight__chrome">
          <span>Candidate achievement</span>
          <button
            ref={closeRef}
            type="button"
            className="dashboard-spotlight__close"
            aria-label="Close achievement spotlight"
            tabIndex={open ? 0 : -1}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="dashboard-spotlight__scroll">
          <div className="dashboard-spotlight__heading">
            <p className="dashboard-spotlight__eyebrow">Your progress, brought forward</p>
            <h2 id="dashboard-spotlight-title">Your Interview Readiness</h2>
            <p id="dashboard-spotlight-summary">
              A focused view of the readiness evidence currently available for {role}.
            </p>
          </div>

          <section
            className={`dashboard-spotlight__overall${
              activeView === "overall" ? " is-active" : ""
            }`}
            aria-label={
              overall == null
                ? "Overall Readiness pending"
                : `Overall Readiness ${overall} out of 100, ${band?.label ?? "readiness"}`
            }
          >
            <div className="dashboard-spotlight__ring">
              <ReadinessRing
                value={overall}
                size={166}
                strokeWidth={10}
                color={band?.color ?? "var(--accent)"}
                suffix="of 100"
                animate={open}
              />
            </div>
            <div className="dashboard-spotlight__overall-copy">
              <span>Overall Readiness</span>
              <strong>{overall == null ? "Pending" : band?.label ?? "Readiness measured"}</strong>
              <p>{modulesDone} of 3 readiness modules complete</p>
            </div>
            <button
              type="button"
              className="dashboard-spotlight__hit"
              aria-label="Inspect Overall Readiness"
              aria-pressed={activeView === "overall"}
              tabIndex={open ? 0 : -1}
              onClick={() =>
                setActiveView((current) =>
                  current === "overall" ? null : "overall",
                )
              }
            />
          </section>

          <div className="dashboard-spotlight__modules" aria-label="Readiness module results">
            <SpotlightModule
              label="Fit Analyzer"
              module={fit}
              index={1}
              selected={activeView === "fit"}
              onSelect={() =>
                setActiveView((current) => (current === "fit" ? null : "fit"))
              }
              open={open}
            />
            <SpotlightModule
              label="Behavioural"
              module={behavioural}
              index={2}
              selected={activeView === "behavioural"}
              onSelect={() =>
                setActiveView((current) =>
                  current === "behavioural" ? null : "behavioural",
                )
              }
              open={open}
            />
            <SpotlightModule
              label="Interview Readiness"
              module={interview}
              state={interviewState}
              provisional={provisional}
              index={3}
              selected={activeView === "interview"}
              onSelect={() =>
                setActiveView((current) =>
                  current === "interview" ? null : "interview",
                )
              }
              open={open}
            />
          </div>

          <div
            className={`dashboard-spotlight__source${provisional ? " is-provisional" : ""}`}
          >
            <div>
              <span>Interview source</span>
              <strong>{sourceCopy}</strong>
            </div>
            <span className="dashboard-spotlight__state">{interviewState}</span>
            <div className="dashboard-spotlight__inspection" aria-live="polite">
              <span>Selected view</span>
              <strong>{activeDetail.title}</strong>
              <small>{activeDetail.supporting}</small>
            </div>
          </div>

          <button
            type="button"
            className="dashboard-spotlight__return"
            tabIndex={open ? 0 : -1}
            onClick={onClose}
          >
            Return to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

function SpotlightModule({
  label,
  module,
  state,
  provisional = false,
  index,
  selected,
  onSelect,
  open,
}: {
  label: string;
  module: ModuleResult;
  state?: string;
  provisional?: boolean;
  index: number;
  selected: boolean;
  onSelect: () => void;
  open: boolean;
}) {
  const score = module.score;
  const displayState =
    state ?? (score == null ? "Pending" : module.status === "done" ? "Complete" : "In progress");

  return (
    <button
      type="button"
      className={`dashboard-spotlight__module${provisional ? " is-provisional" : ""}${
        selected ? " is-active" : ""
      }`}
      style={{ "--spotlight-order": index } as React.CSSProperties}
      aria-label={`${label}: ${score == null ? "Pending" : `${score} out of 100, ${displayState}`}`}
      aria-pressed={selected}
      tabIndex={open ? 0 : -1}
      onClick={onSelect}
    >
      <span>{label}</span>
      <strong>{score ?? "—"}</strong>
      <em>{displayState}</em>
    </button>
  );
}

function spotlightViewDetail({
  activeView,
  overall,
  band,
  fit,
  behavioural,
  interview,
  interviewState,
  modulesDone,
  sourceCopy,
}: {
  activeView: SpotlightView | null;
  overall: number | null;
  band: SpotlightBand | null;
  fit: ModuleResult;
  behavioural: ModuleResult;
  interview: ModuleResult;
  interviewState: string;
  modulesDone: number;
  sourceCopy: string;
}): { title: string; supporting: string } {
  if (activeView == null) {
    return {
      title: "Choose a readiness result",
      supporting:
        "Select Overall, Fit, Behavioural, or Interview Readiness to inspect it.",
    };
  }
  if (activeView === "fit") {
    return {
      title: fit.score == null ? "Fit Analyzer pending" : `Fit Analyzer ${fit.score} out of 100`,
      supporting: fit.statusLine ?? "Complete your role-fit analysis to add this result.",
    };
  }
  if (activeView === "behavioural") {
    return {
      title:
        behavioural.score == null
          ? "Behavioural pending"
          : `Behavioural ${behavioural.score} out of 100`,
      supporting:
        behavioural.statusLine ??
        "Complete a behavioural interview to add this result.",
    };
  }
  if (activeView === "interview") {
    return {
      title:
        interview.score == null
          ? "Interview Readiness pending"
          : `Interview Readiness ${interview.score} out of 100`,
      supporting:
        interview.score == null ? "Complete an interview to add this result." : `${sourceCopy} · ${interviewState}`,
    };
  }
  return {
    title:
      overall == null
        ? "Overall Readiness pending"
        : `${overall} out of 100 · ${band?.label ?? "Readiness measured"}`,
    supporting: `${modulesDone} of 3 readiness modules complete`,
  };
}
