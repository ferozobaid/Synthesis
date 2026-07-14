/**
 * Animated SVG readiness ring. Circumference for r=52 ≈ 327.
 * Pass `value` null for an empty ("—") state.
 */
const CIRC = 327;

export function ReadinessRing({
  value,
  max = 100,
  size = 120,
  strokeWidth = 11,
  color = "var(--accent)",
  suffix,
  animate = true,
}: {
  value: number | null;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  suffix?: string;
  animate?: boolean;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const offset = Math.round(CIRC * (1 - pct));
  const numberSize = Math.round(size * 0.3);

  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg viewBox="0 0 120 120" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" strokeWidth={strokeWidth} />
        {value != null && (
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            style={
              animate
                ? ({
                    animation: "ringGrow 1s .1s ease both",
                    ["--from" as string]: String(CIRC),
                    ["--to" as string]: String(offset),
                  } as React.CSSProperties)
                : undefined
            }
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {value == null ? (
          <div style={{ fontSize: numberSize, fontWeight: 700, color: "var(--ink-4)", letterSpacing: "-.02em" }}>
            —
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: numberSize,
                fontWeight: 700,
                letterSpacing: "-.04em",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                color: "var(--ink)",
              }}
            >
              {value}
            </div>
            {suffix && <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 1 }}>{suffix}</div>}
          </>
        )}
      </div>
    </div>
  );
}
