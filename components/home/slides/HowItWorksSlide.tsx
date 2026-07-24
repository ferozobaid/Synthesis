const STEPS = [
  {
    number: "01",
    title: "Know the role",
    body: "Turn the job description into a clear picture of the capabilities, evidence, and interview signals the role actually demands.",
  },
  {
    number: "02",
    title: "Know your proof",
    body: "See which claims your resume and prepared stories already support—and where an interviewer will expect stronger evidence.",
  },
  {
    number: "03",
    title: "Know what to practice",
    body: "Use one readiness view to focus on the next answer, skill gap, or case habit most likely to improve your performance.",
  },
];

export function HowItWorksSlide() {
  return (
    <div className="home-slide home-slide--process">
      <div className="home-slide__copy">
        <div className="editorial-kicker">Role clarity / 02</div>
        <h1 data-slide-heading tabIndex={-1} className="home-slide__headline">
          <span>Know the role</span>
          <span>before you</span>
          <span>rehearse the</span>
          <span>interview.</span>
        </h1>
        <p className="home-slide__description">
          Synthesis connects the job you want to the evidence you already have, then turns the distance between them
          into a focused preparation plan.
        </p>
      </div>
      <div className="home-process-list">
        {STEPS.map((step) => (
          <article key={step.number}>
            <span>{step.number}</span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
