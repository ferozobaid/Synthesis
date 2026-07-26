"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { useTheme } from "@/components/theme";
import {
  isHowItWorksActive,
  isNavigationRouteActive,
} from "./navigationState";

const PRODUCT_LINKS = [
  { label: "Fit", mobileLabel: "Fit Analyzer", href: "/fit" },
  { label: "Behavioural", mobileLabel: "Behavioural Interview", href: "/behavioural" },
  { label: "GRID", mobileLabel: "The GRID", href: "/case" },
] as const;

export function HeroNav({
  mode,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onLogo,
  onHowItWorks,
  showDashboard = false,
}: {
  mode: "hero" | "carousel";
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onLogo?: () => void;
  onHowItWorks: () => void;
  showDashboard?: boolean;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstMenuLinkRef = useRef<HTMLAnchorElement>(null);
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const howItWorksActive = isHowItWorksActive(pathname, mode);

  useEffect(() => {
    if (!menuOpen) return;
    firstMenuLinkRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseMenu();
      window.requestAnimationFrame(() => toggleRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen, onCloseMenu]);

  const logo = (
    <span className="home-navigation__brand">
      <Logo size={27} />
    </span>
  );

  return (
    <>
      <nav
        aria-label="Synthesis"
        className={`home-navigation home-navigation--${mode}${menuOpen ? " is-menu-open" : ""}`}
      >
        {onLogo ? (
          <button type="button" onClick={onLogo} className="home-navigation__logo" aria-label="Return to Synthesis hero">
            {logo}
          </button>
        ) : (
          <Link
            href="/"
            className="home-navigation__logo"
            aria-label="Synthesis home"
            aria-current={pathname === "/" ? "page" : undefined}
          >
            {logo}
          </Link>
        )}

        <div className="home-navigation__links">
          {PRODUCT_LINKS.map((link) => {
            const active = isNavigationRouteActive(pathname, link.href);
            return (
              <Link
                key={link.label}
                href={link.href}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={onHowItWorks}
            aria-pressed={howItWorksActive}
            data-active={howItWorksActive ? "true" : undefined}
          >
            How it works
          </button>
        </div>

        <div className="home-navigation__actions">
          <button
            type="button"
            onClick={toggle}
            className="home-navigation__theme-toggle"
            data-theme={theme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            <span aria-hidden="true" className="home-navigation__switch-thumb">
              {theme === "dark" ? "☾" : "☼"}
            </span>
          </button>
          {showDashboard && (
            <Link
              href="/dashboard"
              className="home-navigation__dashboard"
              aria-current={
                isNavigationRouteActive(pathname, "/dashboard")
                  ? "page"
                  : undefined
              }
              data-active={
                isNavigationRouteActive(pathname, "/dashboard")
                  ? "true"
                  : undefined
              }
            >
              Dashboard
            </Link>
          )}
          <Link
            href="/onboard"
            className="home-navigation__enter"
            aria-current={
              isNavigationRouteActive(pathname, "/onboard") ? "page" : undefined
            }
          >
            Enter Synthesis
          </Link>
        </div>

        <button
          ref={toggleRef}
          type="button"
          onClick={onToggleMenu}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="home-mobile-menu"
          className="home-navigation__menu-toggle"
        >
          <span /><span /><span />
        </button>
      </nav>

      <div
        id="home-mobile-menu"
        className={`home-mobile-menu${menuOpen ? " is-open" : ""}`}
        aria-hidden={!menuOpen}
      >
        <nav aria-label="Synthesis mobile">
          {PRODUCT_LINKS.map((link, index) => {
            const active = isNavigationRouteActive(pathname, link.href);
            return (
              <Link
                key={link.label}
                ref={index === 0 ? firstMenuLinkRef : undefined}
                href={link.href}
                onClick={onCloseMenu}
                tabIndex={menuOpen ? 0 : -1}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : undefined}
              >
                {link.mobileLabel}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => {
              onCloseMenu();
              onHowItWorks();
            }}
            tabIndex={menuOpen ? 0 : -1}
            aria-pressed={howItWorksActive}
            data-active={howItWorksActive ? "true" : undefined}
          >
            How Synthesis works
          </button>
          {showDashboard && (
            <Link
              href="/dashboard"
              onClick={onCloseMenu}
              tabIndex={menuOpen ? 0 : -1}
              aria-current={
                isNavigationRouteActive(pathname, "/dashboard")
                  ? "page"
                  : undefined
              }
              data-active={
                isNavigationRouteActive(pathname, "/dashboard")
                  ? "true"
                  : undefined
              }
            >
              Dashboard
            </Link>
          )}
          <Link
            href="/onboard"
            onClick={onCloseMenu}
            tabIndex={menuOpen ? 0 : -1}
            aria-current={
              isNavigationRouteActive(pathname, "/onboard") ? "page" : undefined
            }
          >
            Enter Synthesis
          </Link>
        </nav>
      </div>
    </>
  );
}
