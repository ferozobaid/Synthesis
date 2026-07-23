/**
 * Small shared presentational primitives for the Synthesis UI.
 * Inline styles + semantic CSS variables keep them theme-aware.
 */
import type { CSSProperties, ReactNode } from "react";

export function GlassCard({
  children,
  className,
  style,
  shadow = "sm",
  radius = 18,
  padding = 20,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  shadow?: "sm" | "md" | "lg";
  radius?: number;
  padding?: number | string;
}) {
  const shadowVar = shadow === "lg" ? "var(--shadow-lg)" : shadow === "md" ? "var(--shadow-md)" : "var(--shadow-sm)";
  return (
    <div
      className={className}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: radius,
        boxShadow: shadowVar,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({
  children,
  color = "var(--ink-4)",
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: ".13em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StatusBadge({
  label,
  color,
  tint,
}: {
  label: string;
  color: string;
  tint: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        borderRadius: 999,
        background: tint,
        border: "1px solid color-mix(in srgb, currentColor 16%, transparent)",
        color,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

export function MeterBar({
  value,
  max = 100,
  color = "var(--accent)",
  height = 6,
  muted = false,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  muted?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      style={{
        flex: 1,
        height,
        background: "var(--line-2)",
        borderRadius: height,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: color,
          borderRadius: height,
          opacity: muted ? 0.35 : 1,
          transition: "width .7s cubic-bezier(.22,1,.36,1)",
        }}
      />
    </div>
  );
}

export function Spinner({ size = 44, thickness = 3 }: { size?: number; thickness?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `${thickness}px solid var(--line-2)`,
        borderTopColor: "var(--accent)",
        borderRadius: "50%",
        animation: "spin .8s linear infinite",
      }}
    />
  );
}

export function GroundingNote({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "13px 16px",
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        borderRadius: 14,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flex: "none" }} />
      <span style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}
