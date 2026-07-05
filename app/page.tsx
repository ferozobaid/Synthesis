import Link from "next/link";

const MODULES = [
  {
    href: "/fit",
    title: "Fit Analyzer",
    blurb:
      "Score your resume against a job description with O*NET-grounded requirements, hybrid semantic scoring, gaps, and recommendations.",
  },
  {
    href: "/behavioural",
    title: "Behavioural Simulator",
    blurb:
      'Practice behavioural questions, including "why this company", scored against your own STAR answer bank.',
  },
  {
    href: "/case",
    title: "Case Simulator",
    blurb:
      "Work an adaptive consulting case: structure, analysis, dripped exhibits, and a scored recommendation.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight">Synthesis</h1>
        <p className="mt-3 text-lg text-slate-600">
          Voice-enabled, retrieval-assisted interview preparation. Running on
          mocked data - no credentials required.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-3">
        {MODULES.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-accent hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">{m.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{m.blurb}</p>
            <span className="mt-4 inline-block text-sm font-medium text-accent">
              Open
            </span>
          </Link>
        ))}
      </div>

      <footer className="mt-16 text-sm text-slate-400">
        Synthesis - Community Analytics capstone - text-first, voice later.
      </footer>
    </main>
  );
}
