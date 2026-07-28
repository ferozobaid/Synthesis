"use client";

import { useEffect, useRef } from "react";
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
  const provisional =
    interviewSource?.provisional ?? isProvisionalCaseResult(interview);
  const sourceCopy = interviewReadinessSourceCopy(interviewSource);
  const interviewState =
    interview.score == null ? "Pending" : provisional ? "Provisional" : "Complete";

  useEffect(() => {
    if (!open) return;

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
            className="dashboard-spotlight__overall"
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
          </section>

          <div className="dashboard-spotlight__modules" aria-label="Readiness module results">
            <SpotlightModule label="Fit Analyzer" module={fit} index={1} />
            <SpotlightModule label="Behavioural" module={behavioural} index={2} />
            <SpotlightModule
              label="Interview Readiness"
              module={interview}
              state={interviewState}
              provisional={provisional}
              index={3}
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
}: {
  label: string;
  module: ModuleResult;
  state?: string;
  provisional?: boolean;
  index: number;
}) {
  const score = module.score;
  const displayState =
    state ?? (score == null ? "Pending" : module.status === "done" ? "Complete" : "In progress");

  return (
    <div
      className={`dashboard-spotlight__module${provisional ? " is-provisional" : ""}`}
      style={{ "--spotlight-order": index } as React.CSSProperties}
      aria-label={`${label}: ${score == null ? "Pending" : `${score} out of 100, ${displayState}`}`}
    >
      <span>{label}</span>
      <strong>{score ?? "—"}</strong>
      <em>{displayState}</em>
    </div>
  );
}
