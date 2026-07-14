"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Bento module card for the dashboard. Shows icon, status badge, and either a
 * score + "Review" or a start CTA. Lifts on hover.
 */
export function ModuleCard({
  href,
  glyph,
  iconColor,
  iconTint,
  title,
  statusLine,
  badge,
  score,
  ctaLabel,
  hoverBorder = "var(--accent)",
  className,
}: {
  href: string;
  glyph: string;
  iconColor: string;
  iconTint: string;
  title: string;
  statusLine: string;
  badge: { text: string; color: string; tint: string };
  score: number | null;
  ctaLabel: string;
  hoverBorder?: string;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "var(--surface)",
        border: `1px solid ${hover ? hoverBorder : "var(--line)"}`,
        borderRadius: 18,
        padding: 20,
        boxShadow: hover ? "var(--shadow-md)" : "var(--shadow-sm)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        minHeight: 176,
        textDecoration: "none",
        color: "var(--ink)",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform .12s, box-shadow .12s, border-color .12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: iconTint,
            color: iconColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          {glyph}
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: 600,
            color: badge.color,
            background: badge.tint,
            padding: "3px 9px",
            borderRadius: 999,
          }}
        >
          {badge.text}
        </span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>{statusLine}</div>
      <div style={{ flex: 1 }} />
      {score != null ? (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
            <span style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {score}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-4)" }}>/100</span>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-ink)" }}>Review →</span>
        </div>
      ) : (
        <div
          style={{
            marginTop: 14,
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--accent-ink)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {ctaLabel} →
        </div>
      )}
    </Link>
  );
}
