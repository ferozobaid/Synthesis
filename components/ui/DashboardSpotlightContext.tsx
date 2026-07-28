"use client";

import { createContext, useContext } from "react";

export interface DashboardSpotlightControl {
  open: boolean;
  close: () => void;
}

export const DashboardSpotlightContext =
  createContext<DashboardSpotlightControl | null>(null);

export function useDashboardSpotlight(): DashboardSpotlightControl {
  const context = useContext(DashboardSpotlightContext);
  if (!context) {
    throw new Error(
      "useDashboardSpotlight must be used inside the Synthesis site chrome",
    );
  }
  return context;
}
