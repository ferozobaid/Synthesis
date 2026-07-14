"use client";

import { useCallback, useEffect, useState } from "react";

type Theme = "dark" | "light";
const STORAGE_KEY = "synthesis-theme";

/**
 * Theme hook. Dark is the default; the pre-paint script in layout.tsx has
 * already applied the persisted value to <html data-theme> before hydration,
 * so this just mirrors + toggles it.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* storage may be unavailable */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
