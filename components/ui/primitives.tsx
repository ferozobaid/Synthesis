/**
 * Small shared presentational primitives for the Synthesis v3 UI.
 * Inline styles + CSS vars keep them theme-aware without extra Tailwind config.
 */
import type { CSSProperties, ReactNode } from "react";

export function GlassCard({
  children,
  className,
  style,
  shadow = "sm",
  radius = 16,
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
        letterSpacing: ".11em",
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
        padding: "3px 9px",
        borderRadius: 999,
        background: tint,
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
        background: "var(--line)",
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
          transition: "width .8s cubic-bezier(.4,0,.2,1)",
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
        border: `${thickness}px solid var(--line)`,
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
        padding: "12px 16px",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--secondary)", flex: "none" }} />
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{children}</span>
    </div>
  );
}
