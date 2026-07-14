"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { useReadiness } from "@/components/readiness-store";
import { useTheme } from "@/components/theme";

export function SiteNav() {
  const pathname = usePathname();
  const { state } = useReadiness();
  const { theme, toggle } = useTheme();
  const role = state.target.role ?? "Not set yet";
  const onDash = pathname === "/dashboard";

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--nav-bg)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        className="nav-inner"
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          padding: "0 32px",
          height: 60,
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <Link href="/dashboard" style={{ textDecoration: "none" }}>
          <Logo />
        </Link>
        <div className="nav-dash-link" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Link
            href="/dashboard"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: onDash ? "var(--ink)" : "var(--ink-3)",
              textDecoration: "none",
              padding: "6px 10px",
              borderRadius: 8,
              background: onDash ? "var(--surface)" : "transparent",
              border: `1px solid ${onDash ? "var(--line)" : "transparent"}`,
            }}
          >
            Dashboard
          </Link>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 13px 5px 8px",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 999,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2px solid var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)" }} />
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div
              style={{
                fontSize: 8.5,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
                fontFamily: "var(--font-mono)",
              }}
            >
              Target role
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{role}</div>
          </div>
        </div>
        <button
          onClick={toggle}
          title="Switch theme"
          aria-label="Switch theme"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            cursor: "pointer",
            color: "var(--ink-2)",
          }}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
        <div
          className="nav-demo-chip"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: ".04em",
            color: "var(--ink-3)",
            border: "1px solid var(--line)",
            background: "var(--surface-2)",
            padding: "4px 9px",
            borderRadius: 6,
          }}
        >
          Demo build
        </div>
      </div>
    </div>
  );
}
