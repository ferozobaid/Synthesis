"use client";

import Link from "next/link";
import { HERO_MODULES, HERO_MODULE_ORDER } from "./modules";

const NAV_LINKS = [
  ...HERO_MODULE_ORDER.map((key) => ({ label: HERO_MODULES[key].nav, href: HERO_MODULES[key].href })),
  { label: "How it works", href: "#synthesis-platform" },
];

const MENU_LINKS = [
  ...HERO_MODULE_ORDER.map((key) => ({ label: HERO_MODULES[key].name, href: HERO_MODULES[key].href })),
  { label: "How Synthesis Works", href: "#synthesis-platform" },
  { label: "Enter Synthesis", href: "/onboard" },
];

interface HeroNavProps {
  /** Adds a translucent black backdrop once the page has scrolled. */
  solid: boolean;
  /** Fades the nav out once the hero has been scrolled past. */
  hidden: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
}

/**
 * Fixed navigation for the cinematic hero. It hands off to the existing
 * landing header below by fading out when the hero leaves the viewport.
 */
export function HeroNav({ solid, hidden, menuOpen, onToggleMenu, onCloseMenu }: HeroNavProps) {
  return (
    <>
      <nav
        aria-label="Synthesis hero"
        className={[
          "fixed top-0 left-0 right-0 z-50 px-5 sm:px-8 lg:px-10 py-4 sm:py-5 flex items-center justify-between",
          "transition-all duration-500",
          solid || menuOpen ? "bg-black/75 backdrop-blur-xl" : "bg-black/0",
          hidden && !menuOpen ? "opacity-0 -translate-y-3 pointer-events-none" : "opacity-100",
        ].join(" ")}
      >
        <Link
          href="/"
          aria-label="Synthesis home"
          className="flex items-center gap-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80"
        >
          <span className="relative flex h-[24px] w-[24px] items-center justify-center rounded-full border border-white/70 shero-pulse-slow">
            <span className="h-[6px] w-[6px] rounded-full bg-white" />
          </span>
          <span
            className="uppercase text-[20px] sm:text-[24px] tracking-[-0.04em] font-semibold"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Synthesis
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-9 lg:gap-11">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-[15px] lg:text-[16px] text-white/80 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden md:block">
          <Link
            href="/onboard"
            className="rounded-full border border-white/40 bg-white/10 backdrop-blur-md text-white px-5 py-2.5 text-[14px] sm:text-[15px] hover:bg-white hover:text-black transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
          >
            Enter Synthesis
          </Link>
        </div>

        <button
          type="button"
          onClick={onToggleMenu}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          className="md:hidden relative z-50 flex h-10 w-10 flex-col items-center justify-center gap-[6px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
        >
          <span
            className={`w-6 h-[1.5px] bg-white transition-all duration-300 ${menuOpen ? "translate-y-[7.5px] rotate-45" : ""}`}
          />
          <span className={`w-6 h-[1.5px] bg-white transition-all duration-300 ${menuOpen ? "opacity-0" : ""}`} />
          <span
            className={`w-6 h-[1.5px] bg-white transition-all duration-300 ${menuOpen ? "-translate-y-[7.5px] -rotate-45" : ""}`}
          />
        </button>
      </nav>

      {/* Mobile overlay */}
      <div
        className={[
          "fixed inset-0 z-40 bg-black/95 backdrop-blur-xl px-7 flex flex-col justify-center md:hidden",
          "transition-all duration-300",
          menuOpen ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none",
        ].join(" ")}
        aria-hidden={!menuOpen}
      >
        <nav aria-label="Synthesis mobile">
          {MENU_LINKS.map((link, i) => (
            <div key={link.label}>
              {i > 0 && <div className="h-px bg-white/15" />}
              <a
                href={link.href}
                onClick={onCloseMenu}
                tabIndex={menuOpen ? 0 : -1}
                className="block py-5 text-[34px] tracking-tight text-white font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {link.label}
              </a>
            </div>
          ))}
        </nav>
      </div>
    </>
  );
}
