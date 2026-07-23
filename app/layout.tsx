import type { Metadata } from "next";
import "./globals.css";
import { ReadinessProvider } from "@/components/readiness-store";
import { SiteChrome } from "@/components/ui/SiteChrome";

export const metadata: Metadata = {
  title: "Synthesis — Interview Readiness",
  description:
    "Diagnose your resume fit, coach your behavioural answers, and drill live case interviews — rolled into one readiness score.",
};

// Runs before paint: applies the persisted theme so there's no flash. Dark is
// the default; only an explicit stored preference of "light" switches it.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('synthesis-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body>
        <ReadinessProvider>
          <SiteChrome>{children}</SiteChrome>
        </ReadinessProvider>
      </body>
    </html>
  );
}
