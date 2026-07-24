export type ModuleKey = "fit" | "behavioural" | "case";

export interface HeroModule {
  /** Editorial index shown inside pills and the status line. */
  index: string;
  /** Short nav label. */
  nav: string;
  /** Pill call-to-action label. */
  pill: string;
  /** Full name used in the mobile menu and status line. */
  name: string;
  /** Uppercase session name shown in the signal panel. */
  session: string;
  /** Live-session status verb shown next to the pulsing dot. */
  status: string;
  /** One-line description shown under the action pills. */
  brief: string;
  href: string;
  /** [label, baseline score] rows for the signal panel. */
  rows: [string, number][];
}

export const HERO_MODULE_ORDER: ModuleKey[] = ["fit", "behavioural", "case"];

export const HERO_MODULES: Record<ModuleKey, HeroModule> = {
  fit: {
    index: "01",
    nav: "Fit",
    pill: "Analyze my fit",
    name: "Fit Analyzer",
    session: "FIT ANALYZER",
    status: "Reading evidence",
    brief:
      "Parses your resume against the job description and shows where you match, partially match, and fall short — each verdict backed by a line of your own evidence.",
    href: "/fit",
    rows: [
      ["Requirements met", 72],
      ["Evidence strength", 68],
      ["Role alignment", 76],
    ],
  },
  behavioural: {
    index: "02",
    nav: "Behavioural",
    pill: "Practice behavioural",
    name: "Behavioural Interview",
    session: "BEHAVIOURAL VOICE",
    status: "Listening",
    brief:
      "Runs a live voice interview on real questions, then scores every answer and hands back a stronger version built from your own experience.",
    href: "/behavioural",
    rows: [
      ["Response clarity", 84],
      ["Structure", 78],
      ["Evidence", 91],
    ],
  },
  case: {
    index: "03",
    nav: "Case",
    pill: "Run a case",
    name: "Case Interview",
    session: "CASE SIMULATION",
    status: "Probing hypothesis",
    brief:
      "Drops you into an adaptive strategy case — an interviewer that probes, redirects, reveals exhibits, and scores the full session at the end.",
    href: "/case",
    rows: [
      ["Framework", 81],
      ["Quant accuracy", 76],
      ["Synthesis", 88],
    ],
  },
};
