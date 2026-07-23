/**
 * Synthesis wordmark — a restrained lens mark with one clear focal point.
 */
export function Logo({ size = 26, showWord = true }: { size?: number; showWord?: boolean }) {
  const dot = Math.round(size * 0.35);
  const focal = Math.round(size * 0.15);
  return (
    <div className="brand-lockup" style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div
        className="brand-mark"
        style={{
          width: size,
          height: size,
          borderRadius: Math.max(4, size * 0.18),
          background: "var(--brand-block)",
          border: "1px solid var(--brand-block)",
          boxShadow: `${Math.max(3, size * 0.14)}px ${Math.max(3, size * 0.14)}px 0 var(--accent)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          flex: "none",
        }}
      >
        <div
          className="brand-mark__ring"
          style={{
            width: dot,
            height: dot,
            borderRadius: "50%",
            border: "1.75px solid var(--brand-block-ink)",
          }}
        />
        <div
          className="brand-mark__focal"
          style={{
            position: "absolute",
            right: size * 0.19,
            top: size * 0.19,
            width: focal,
            height: focal,
            borderRadius: "50%",
            background: "var(--accent)",
          }}
        />
      </div>
      {showWord && (
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, letterSpacing: ".16em", color: "var(--ink)", textTransform: "uppercase" }}>
          Synthesis
        </span>
      )}
    </div>
  );
}
