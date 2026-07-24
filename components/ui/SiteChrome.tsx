"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HeroNav } from "@/components/hero/HeroNav";
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
  const hideNav = pathname === "/";
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const shell = shellRef.current;
    if (hideNav || !shell) return;
    const preventRouteSwipe = (event: WheelEvent) => {
      if (!isDominantHorizontalGesture(event.deltaX, event.deltaY)) return;
      if (elementCanConsumeHorizontalDelta(event.target, shell, event.deltaX)) return;
      event.preventDefault();
    };
    shell.addEventListener("wheel", preventRouteSwipe, { passive: false });
    return () => shell.removeEventListener("wheel", preventRouteSwipe);
  }, [hideNav]);

  if (hideNav) return <>{children}</>;

  return (
    <div ref={shellRef} className="product-experience">
      <HeroNav
        mode="carousel"
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
        onHowItWorks={() => router.push("/?view=how-it-works")}
        showDashboard
      />
      <div className="product-experience__content">{children}</div>
    </div>
  );
}
