import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synthesis - Interview Prep",
  description:
    "Voice-enabled, retrieval-assisted interview preparation: fit analysis, behavioural, and case simulators.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
