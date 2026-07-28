"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HeroNav } from "@/components/hero/HeroNav";
import { DashboardSpotlightContext } from "@/components/ui/DashboardSpotlightContext";
import {
  elementCanConsumeHorizontalDelta,
  isDominantHorizontalGesture,
} from "@/components/ui/productGestureGuard";

/**
 * Wraps app content with the sticky nav — except on the landing page (`/`),
 * which has its own self-contained header.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const spotlightTriggerRef = useRef<HTMLElement | null>(null);
  const hideNav = pathname === "/";
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setSpotlightOpen(false);
  }, [pathname]);

  const closeSpotlight = useCallback(() => {
    setSpotlightOpen(false);
    window.requestAnimationFrame(() => spotlightTriggerRef.current?.focus());
  }, []);

  const toggleSpotlight = useCallback((trigger: HTMLElement) => {
    spotlightTriggerRef.current = trigger;
    setSpotlightOpen((open) => {
      if (open) {
        window.requestAnimationFrame(() => trigger.focus());
        return false;
      }
      return true;
    });
  }, []);

  const spotlightControl = useMemo(
    () => ({
      open: spotlightOpen,
      activate: toggleSpotlight,
      close: closeSpotlight,
    }),
    [closeSpotlight, spotlightOpen, toggleSpotlight],
  );

  useEffect(() => {
    const shell = shellRef.current;
    if (hideNav || !shell) return;
    const preventRouteSwipe = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (!isDominantHorizontalGesture(event.deltaX, event.deltaY)) return;
      if (elementCanConsumeHorizontalDelta(event.target, shell, event.deltaX)) return;
      event.preventDefault();
    };
    shell.addEventListener("wheel", preventRouteSwipe, {
      passive: false,
      capture: true,
    });
    return () => shell.removeEventListener("wheel", preventRouteSwipe, true);
  }, [hideNav]);

  if (hideNav) return <>{children}</>;

  return (
    <DashboardSpotlightContext.Provider value={spotlightControl}>
      <div ref={shellRef} className="product-experience">
        <HeroNav
          mode="carousel"
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen((open) => !open)}
          onCloseMenu={() => setMenuOpen(false)}
          onHowItWorks={() => router.push("/?view=how-it-works")}
          onDashboardSpotlight={toggleSpotlight}
          dashboardSpotlightOpen={spotlightOpen}
          showDashboard
        />
        <div className="product-experience__content">{children}</div>
      </div>
    </DashboardSpotlightContext.Provider>
  );
}
