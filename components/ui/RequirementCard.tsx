import { statusColor } from "./verdict";
import type { RequirementStatus } from "@/lib/types";

/**
 * A single per-requirement result on the Fit screen: status glyph + title +
 * must/nice tag + status badge, with the resume evidence quoted beneath.
 */
export function RequirementCard({
  requirement,
  status,
  evidence,
  mustHave,
}: {
  requirement: string;
  status: RequirementStatus;
  evidence: string | null;
  mustHave: boolean;
}) {
  const sc = statusColor(status);
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderLeft: `3px solid ${sc.color}`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: evidence ? 9 : 0 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            background: sc.tint,
            color: sc.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            flex: "none",
          }}
        >
          {sc.glyph}
        </div>
        <span style={{ fontSize: 15, fontWeight: 600, flex: 1, letterSpacing: "-.01em", color: "var(--ink)" }}>
          {requirement}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: "var(--ink-4)",
          }}
        >
          {mustHave ? "must-have" : "nice-to-have"}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: sc.color,
            background: sc.tint,
            padding: "3px 9px",
            borderRadius: 999,
          }}
        >
          {sc.label}
        </span>
      </div>
      {evidence && (
        <div
          style={{
            paddingLeft: 33,
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--ink-2)",
            borderLeft: "2px solid var(--line-2)",
            marginLeft: 10,
          }}
        >
          {evidence}
        </div>
      )}
    </div>
  );
}
