import { ReadinessRing } from "./ReadinessRing";

/**
 * Result-screen header: score ring + a band pill + a one-sentence plain-language
 * verdict. Used at the top of Fit, Behavioural summary, and Case report.
 */
export function VerdictBanner({
  score,
  max = 100,
  suffix = "fit score",
  bandLabel,
  bandColor,
  bandTint,
  verdict,
  ringColor = "var(--accent)",
  tintFrom = "var(--accent-tint-2)",
}: {
  score: number;
  max?: number;
  suffix?: string;
  bandLabel: string;
  bandColor: string;
  bandTint: string;
  verdict: string;
  ringColor?: string;
  tintFrom?: string;
}) {
  return (
    <div
      style={{
        background: `linear-gradient(120deg, var(--surface), ${tintFrom})`,
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: "26px 28px",
        boxShadow: "var(--shadow-md)",
        display: "flex",
        alignItems: "center",
        gap: 28,
        marginBottom: 22,
        flexWrap: "wrap",
      }}
    >
      <ReadinessRing value={score} max={max} size={104} color={ringColor} suffix={suffix} />
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "4px 11px",
            background: bandTint,
            borderRadius: 999,
            marginBottom: 10,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: bandColor }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: bandColor }}>{bandLabel}</span>
        </div>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 18,
            lineHeight: 1.45,
            color: "var(--ink)",
            margin: 0,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {verdict}
        </p>
      </div>
    </div>
  );
}
