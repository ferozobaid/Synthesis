/**
 * Synthesis wordmark — a lens ring with a single focal point: scattered signals
 * brought into one clear picture of readiness.
 */
export function Logo({ size = 26, showWord = true }: { size?: number; showWord?: boolean }) {
  const dot = Math.round(size * 0.35);
  const focal = Math.round(size * 0.15);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.27,
          background: "var(--glow)",
          boxShadow: "0 0 16px rgba(124,120,255,.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          flex: "none",
        }}
      >
        <div
          style={{
            width: dot,
            height: dot,
            borderRadius: "50%",
            border: "2px solid var(--paper)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: size * 0.19,
            top: size * 0.19,
            width: focal,
            height: focal,
            borderRadius: "50%",
            background: "#fff",
          }}
        />
      </div>
      {showWord && (
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-.02em", color: "var(--ink)" }}>
          Synthesis
        </span>
      )}
    </div>
  );
}
