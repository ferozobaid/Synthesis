/**
 * Horizontal stage progression for the case interview. Purely visual — it
 * reflects the FSM stage index without exposing FSM internals.
 */
export function StageTracker({
  stages,
  currentIdx,
  complete = false,
}: {
  stages: string[];
  currentIdx: number;
  complete?: boolean;
}) {
  return (
    <div
      className={`stage-tracker stage-tracker--${stages.length}`}
      role="list"
    >
      {stages.map((name, i) => {
        const done = complete || i < currentIdx;
        const active = !complete && i === currentIdx;
        const showLine = i < stages.length - 1;
        return (
          <div
            key={name}
            className={`stage-tracker__step${done ? " is-done" : ""}${active ? " is-active" : ""}`}
            role="listitem"
            aria-current={active ? "step" : undefined}
          >
            <span className="stage-tracker__dot" aria-hidden="true" />
            <span className="stage-tracker__label">{name}</span>
            {showLine && (
              <span className="stage-tracker__connector" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}
