"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pure decision core for the scroll-reveal hook, node-testable.
 *
 * "revealed" here means the element renders in its final, visible state.
 * The rule is fail-open: content is only ever hidden when IntersectionObserver
 * exists, motion is allowed, and the element has not yet intersected — every
 * other combination (SSR, missing IO, reduced motion) renders visible.
 */
export function resolveRevealState(
  ioSupported: boolean,
  reducedMotion: boolean,
  intersected: boolean,
): boolean {
  if (!ioSupported || reducedMotion) return true;
  return intersected;
}

/**
 * Reveal-on-scroll: returns a ref plus a `revealed` flag that flips true the
 * first time the element enters the viewport (then unobserves). Initial state
 * is visible, so no-JS and first paint can never leave content hidden — the
 * pre-reveal styling is applied by the caller only after mount, when the
 * environment is known to support it.
 */
export function useRevealOnScroll<T extends HTMLElement>(): {
  ref: React.RefObject<T>;
  revealed: boolean;
} {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(true);

  useEffect(() => {
    const element = ref.current;
    const ioSupported = typeof IntersectionObserver !== "undefined";
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!element || resolveRevealState(ioSupported, reducedMotion, false)) return;

    // Already in view? Stay visible — never dip an on-screen element.
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;

    setRevealed(false);
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      setRevealed(true);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reveal();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    // Belt-and-braces: a passive scroll check guarantees the reveal even if
    // the observer misbehaves — content must never stay hidden.
    const onScroll = () => {
      const r = element.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) reveal();
    };
    observer.observe(element);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return { ref, revealed };
}
