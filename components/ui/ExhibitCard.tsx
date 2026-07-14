"use client";

import { useState } from "react";

interface Exhibit {
  title?: string;
  synthesized?: boolean;
  insights?: string[];
  data?: unknown;
  [k: string]: unknown;
}

/**
 * Case exhibit — insight-first. Raw figures live behind a "View data" toggle so
 * the candidate reads the takeaway, not a JSON blob.
 */
export function ExhibitCard({ exhibit, index }: { exhibit: Exhibit; index: number }) {
  const [open, setOpen] = useState(false);
  const insights = Array.isArray(exhibit.insights) ? exhibit.insights : [];
  const hasData = exhibit.data != null;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 15,
        boxShadow: "var(--shadow-sm)",
        animation: "fadeUp .4s ease both",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--secondary)",
            background: "var(--secondary-tint)",
            padding: "2px 7px",
            borderRadius: 5,
          }}
        >
          E{index + 1}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.25, color: "var(--ink)" }}>
          {exhibit.title ?? "Exhibit"}
        </span>
      </div>

      {insights.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 7,
            background: "var(--secondary-tint)",
            borderRadius: 9,
            padding: "11px 12px",
            marginBottom: hasData ? 10 : 0,
          }}
        >
          {insights.map((ins, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <span style={{ color: "var(--secondary)", fontSize: 12, marginTop: 1 }}>◆</span>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink)" }}>{ins}</div>
            </div>
          ))}
        </div>
      )}

      {hasData && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={`exhibit-data-${index}`}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--accent-ink)",
              cursor: "pointer",
              userSelect: "none",
              background: "none",
              border: "none",
              padding: 0,
            }}
          >
            {open ? "Hide data" : "View data"}
          </button>
          {open && (
            <pre
              id={`exhibit-data-${index}`}
              style={{
                marginTop: 10,
                borderTop: "1px solid var(--line)",
                paddingTop: 10,
                maxHeight: 220,
                overflow: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--ink-2)",
                margin: 0,
              }}
            >
              {JSON.stringify(exhibit.data, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
