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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@1,6..72,400;1,6..72,500&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ReadinessProvider>
          <SiteChrome>{children}</SiteChrome>
        </ReadinessProvider>
      </body>
    </html>
  );
}
