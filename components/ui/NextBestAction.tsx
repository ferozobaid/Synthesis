import Link from "next/link";

/**
 * The glow gradient CTA card — the dashboard's "Your next best action" and the
 * "Focus next on" footers on result screens.
 */
export function NextBestAction({
  eyebrow = "Your next best action",
  title,
  desc,
  cta,
  href,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
  cta: string;
  href: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--glow)",
        borderRadius: compact ? 16 : 18,
        padding: compact ? "20px 24px" : "24px 26px",
        color: "#fff",
        boxShadow: "0 10px 34px rgba(124,120,255,.3)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: compact ? "row" : "column",
        alignItems: compact ? "center" : "flex-start",
        justifyContent: compact ? "space-between" : "center",
        gap: compact ? 20 : 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -40,
          top: -40,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(91,87,232,.4),transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: "rgba(255,255,255,.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
            }}
          >
            ✦
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,.6)",
            }}
          >
            {eyebrow}
          </div>
        </div>
        <div
          style={{
            fontSize: compact ? 16 : 22,
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: "-.02em",
            marginBottom: desc ? 8 : 0,
            maxWidth: 440,
          }}
        >
          {title}
        </div>
        {desc && (
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "rgba(255,255,255,.72)",
              maxWidth: 440,
              marginBottom: compact ? 0 : 18,
            }}
          >
            {desc}
          </div>
        )}
      </div>
      <Link
        href={href}
        style={{
          position: "relative",
          flex: "none",
          border: "none",
          background: "#fff",
          color: "#0b1020",
          fontSize: 14,
          fontWeight: 600,
          padding: "12px 20px",
          borderRadius: 10,
          cursor: "pointer",
          whiteSpace: "nowrap",
          textDecoration: "none",
        }}
      >
        {cta} →
      </Link>
    </div>
  );
}
