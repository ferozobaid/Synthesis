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
  scoreLabel,
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
  scoreLabel?: string;
  ctaLabel: string;
  hoverBorder?: string;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  const inverse = className?.includes("module-card--inverse") ?? false;
  const signal = className?.includes("module-card--signal") ?? false;
  const foreground = inverse ? "var(--inverse-ink)" : signal ? "var(--codex-gray-contrast)" : "var(--ink)";
  const muted = inverse
    ? "color-mix(in srgb, var(--inverse-ink) 64%, transparent)"
    : signal
      ? "color-mix(in srgb, var(--codex-gray-contrast) 68%, transparent)"
      : "var(--ink-3)";
  const cardBackground = inverse ? "var(--inverse)" : signal ? "var(--codex-gray)" : "var(--surface)";
  const cardBorder = inverse ? "var(--inverse)" : signal ? "var(--codex-gray)" : "var(--line)";
  const sequence = href === "/fit" ? "01" : href === "/behavioural" ? "02" : "03";

  return (
    <Link
      href={href}
      className={`module-card ${className ?? ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: cardBackground,
        border: `1px solid ${hover ? `color-mix(in srgb, ${hoverBorder} 70%, ${cardBorder})` : cardBorder}`,
        borderRadius: 2,
        padding: 24,
        boxShadow: hover ? "7px 7px 0 var(--line-strong)" : "var(--shadow-sm)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        minHeight: 236,
        textDecoration: "none",
        color: foreground,
        transform: hover ? "translate(-2px, -2px)" : "none",
        transition: "transform .16s ease, box-shadow .16s ease, border-color .16s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div
          className="module-card__icon"
          style={{
            width: 44,
            height: 44,
            borderRadius: 0,
            border: `1px solid ${muted}`,
            background: inverse || signal ? "transparent" : iconTint,
            color: inverse || signal ? foreground : iconColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          {glyph}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 10,
              fontWeight: 650,
              fontFamily: "var(--font-mono)",
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: inverse || signal ? foreground : badge.color,
              background: inverse || signal ? "transparent" : badge.tint,
              border: inverse || signal ? `1px solid ${muted}` : "1px solid transparent",
              padding: "4px 8px",
              borderRadius: 0,
            }}
          >
            {badge.text}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".16em", color: muted }}>{sequence}</span>
        </div>
      </div>
      <div style={{ fontSize: 25, fontWeight: 670, letterSpacing: "-.045em", lineHeight: 1.05 }}>{title}</div>
      <div style={{ fontSize: 13, color: muted, lineHeight: 1.5, marginTop: 8, maxWidth: 250 }}>{statusLine}</div>
      <div style={{ flex: 1 }} />
      {score != null ? (
        <div style={{ marginTop: 14 }}>
          {scoreLabel && (
            <div style={{ marginBottom: 7, color: muted, fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase" }}>
              {scoreLabel}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {score}
              </span>
              <span style={{ fontSize: 11, color: muted }}>/100</span>
            </div>
            <span className="module-card__cta" style={{ fontSize: 13, fontWeight: 650, color: foreground }}>Review <span aria-hidden="true">→</span></span>
          </div>
        </div>
      ) : (
        <div
          className="module-card__cta"
          style={{
            marginTop: 14,
            fontSize: 13.5,
            fontWeight: 650,
            color: foreground,
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
