"use client";

import Link from "next/link";
import { HERO_MODULES, HERO_MODULE_ORDER, type ModuleKey } from "./modules";

function ArrowRight() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="transition-transform duration-300 group-hover:translate-x-[3px]"
    >
      <path d="M1 6h10M7 2l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUpRight() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="transition-transform duration-300 group-hover:translate-x-[2px] group-hover:-translate-y-[2px]"
    >
      <path d="M2.5 9.5 9.5 2.5M4 2.5h5.5V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The hero's primary CTA plus one pill per module. Hover/focus reports the
 * module upward so the signal panel and brief line follow along.
 */
export function ProductPills({ onSpotlight }: { onSpotlight: (key: ModuleKey | null) => void }) {
  return (
    <div className="mt-7 sm:mt-8 flex flex-wrap items-center gap-2.5 max-w-[720px]">
      <Link
        href="/onboard"
        className="group -order-1 sm:order-none inline-flex items-center gap-3 rounded-full bg-white text-black border border-white text-[13px] sm:text-[15px] px-5 sm:px-6 py-2.5 sm:py-3 font-medium hover:bg-transparent hover:text-white transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
      >
        Start preparing
        <ArrowUpRight />
      </Link>
      {HERO_MODULE_ORDER.map((key) => {
        const mod = HERO_MODULES[key];
        return (
          <Link
            key={key}
            href={mod.href}
            onMouseEnter={() => onSpotlight(key)}
            onMouseLeave={() => onSpotlight(null)}
            onFocus={() => onSpotlight(key)}
            onBlur={() => onSpotlight(null)}
            className="group inline-flex items-center justify-center gap-3 rounded-full border border-white/25 bg-white/10 backdrop-blur-md text-white text-[13px] sm:text-[15px] px-4 sm:px-5 py-2.5 sm:py-3 transition-all duration-300 hover:bg-white hover:text-black hover:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
          >
            <span className="font-mono text-[10px] tracking-[0.1em] opacity-60">{mod.index}</span>
            {mod.pill}
            <ArrowRight />
          </Link>
        );
      })}
    </div>
  );
}
