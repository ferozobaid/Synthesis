"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HeroNav } from "@/components/hero/HeroNav";

/**
 * Wraps app content with the sticky nav — except on the landing page (`/`),
 * which has its own self-contained header.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const hideNav = pathname === "/";

  useEffect(() => setMenuOpen(false), [pathname]);

  if (hideNav) return <>{children}</>;

  return (
    <div className="product-experience">
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
