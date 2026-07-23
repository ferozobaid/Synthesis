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
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        className="nav-inner"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 32px",
          height: 72,
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <Link href="/" aria-label="Go to the Synthesis landing page" style={{ textDecoration: "none" }}>
          <Logo />
        </Link>
        <div className="nav-dash-link" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Link
            href="/dashboard"
            aria-label="Dashboard"
            aria-current={onDash ? "page" : undefined}
            className="nav-dashboard-link"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 500,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: onDash ? "var(--ink)" : "var(--ink-3)",
              textDecoration: "none",
              padding: "9px 0 7px",
              borderRadius: 0,
              background: "transparent",
              borderBottom: `1px solid ${onDash ? "var(--accent)" : "transparent"}`,
            }}
          >
            <span className="nav-dashboard-label--full">Dashboard</span>
            <span className="nav-dashboard-label--compact">Dash</span>
          </Link>
        </div>
        <div style={{ flex: 1 }} />
        <div
          className="nav-role-pill"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 13px 6px 9px",
            background: "transparent",
            border: "1px solid var(--line)",
            borderRadius: 7,
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              border: "1px solid var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <div style={{ width: 5, height: 5, borderRadius: 1, background: "var(--accent)" }} />
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
            <div className="nav-role-value" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{role}</div>
          </div>
        </div>
        <button
          onClick={toggle}
          className="nav-theme-toggle"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          style={{
            width: 36,
            height: 36,
            borderRadius: 7,
            border: "1px solid var(--line)",
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            cursor: "pointer",
            color: "var(--ink-2)",
          }}
        >
          {theme === "dark" ? "☼" : "☾"}
        </button>
        <div
          className="nav-demo-chip"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 8.5,
            fontWeight: 500,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            border: "1px solid var(--line)",
            background: "transparent",
            padding: "6px 9px",
            borderRadius: 5,
          }}
        >
          Demo build
        </div>
      </div>
    </div>
  );
}
