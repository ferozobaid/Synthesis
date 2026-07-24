import Link from "next/link";

const MODULES = [
  {
    number: "01",
    glyph: "◎",
    title: "Resume Fit",
    body: "See where you match, partially match, and fall short of the role — each backed by a line of evidence from your resume.",
    href: "/fit",
    action: "Analyze my fit",
    variant: "inverse",
  },
  {
    number: "02",
    glyph: "◈",
    title: "Behavioural",
    body: "Answer real questions with a STAR scaffold, then get scored coaching and a stronger version of every answer.",
    href: "/behavioural",
    action: "Practice behavioural",
    variant: "signal",
  },
  {
    number: "03",
    glyph: "◆",
    title: "The GRID",
    body: "Enter a live Case Simulation now, with role-specific Technical Simulation previews ready for what comes next.",
    href: "/case",
    action: "Run a case",
    variant: "neutral",
  },
] as const;

export function ModulesOverviewSlide() {
  return (
    <div className="home-slide home-slide--modules">
      <header className="home-modules-heading">
        <div>
          <div className="editorial-kicker">Practice system / 03</div>
          <h1 data-slide-heading tabIndex={-1}>Three modules, one score</h1>
        </div>
        <p>Each returns a verdict, a score, and a clear next step.</p>
      </header>
      <div className="home-modules-grid">
        {MODULES.map((module) => (
          <Link
            key={module.title}
            href={module.href}
            className={`home-module-card home-module-card--${module.variant}`}
          >
            <span className="home-module-card__number">{module.number}</span>
            <span className="home-module-card__glyph" aria-hidden="true">{module.glyph}</span>
            <h2>{module.title}</h2>
            <p>{module.body}</p>
            <strong>{module.action} →</strong>
          </Link>
        ))}
      </div>
      <div className="home-modules-cta">
        <Link href="/fit" className="app-button app-button--primary">
          Start with your role →
        </Link>
        <span>One role. One readiness plan.</span>
      </div>
    </div>
  );
}
