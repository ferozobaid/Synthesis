"use client";

import { usePathname } from "next/navigation";
import { SiteNav } from "./SiteNav";

/**
 * Wraps app content with the sticky nav — except on the landing page (`/`),
 * which has its own self-contained header.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideNav = pathname === "/";
  return (
    <>
      {!hideNav && <SiteNav />}
      {children}
    </>
  );
}
