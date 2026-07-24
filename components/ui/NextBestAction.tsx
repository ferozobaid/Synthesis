import Link from "next/link";

/**
 * The focused CTA panel — the dashboard's "Your next best action" and the
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
      className="next-best-action"
      style={{
        background: "var(--accent)",
        borderRadius: 2,
        padding: compact ? "20px 24px" : "30px",
        color: "var(--accent-contrast)",
        border: "1px solid var(--accent)",
        boxShadow: "8px 8px 0 var(--accent-tint)",
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
        className="next-best-action__frame"
        style={{
          position: "absolute",
          right: -12,
          top: 34,
          width: 176,
          height: 128,
          borderRadius: 0,
          border: "1px solid color-mix(in srgb, var(--accent-contrast) 34%, transparent)",
          background: "transparent",
          transform: "rotate(-5deg)",
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
            className="next-best-action__icon"
            style={{
              width: 26,
              height: 26,
              borderRadius: 0,
              border: "1px solid color-mix(in srgb, var(--accent-contrast) 38%, transparent)",
              background: "transparent",
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
              color: "color-mix(in srgb, var(--accent-contrast) 68%, transparent)",
            }}
          >
            {eyebrow}
          </div>
        </div>
        <div
          style={{
            fontSize: compact ? 16 : 22,
            fontWeight: 650,
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
              color: "color-mix(in srgb, var(--accent-contrast) 74%, transparent)",
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
        className="next-best-action__cta"
        style={{
          position: "relative",
          flex: "none",
          border: "none",
          background: "var(--accent-contrast)",
          color: "var(--accent)",
          fontSize: 14,
          fontWeight: 600,
          padding: "12px 20px",
          borderRadius: 0,
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
