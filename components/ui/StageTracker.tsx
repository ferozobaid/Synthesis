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
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 10 }}>
      {stages.map((name, i) => {
        const done = complete || i < currentIdx;
        const active = !complete && i === currentIdx;
        const dotColor = active ? "var(--accent)" : done ? "var(--success)" : "var(--line)";
        const showLine = i < stages.length - 1;
        return (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: dotColor,
                  boxShadow: active ? "0 0 0 4px var(--accent-tint)" : "none",
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: ".02em",
                  color: active ? "var(--ink)" : done ? "var(--ink-2)" : "var(--ink-4)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {name}
              </span>
            </div>
            {showLine && (
              <div
                style={{
                  width: 26,
                  height: 2,
                  marginBottom: 20,
                  borderRadius: 2,
                  background: done ? "var(--success)" : "var(--line)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
