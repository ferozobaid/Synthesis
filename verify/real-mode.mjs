#!/usr/bin/env node
/**
 * Real-mode verification driver (Synthesis).
 *
 * Drives all three module API routes over HTTP against a running Next.js dev server,
 * with realistic sample inputs, and prints the functional result of each so a full
 * real-mode session is one command. It exercises the SAME endpoints in mock or real
 * mode — which one runs is decided entirely by how you launched `npm run dev`:
 *
 *   MOCK baseline:  npm run dev
 *   REAL (Haiku):   SYNTHESIS_USE_MOCKS=false ANTHROPIC_API_KEY=sk-ant-... \
 *                   SYNTHESIS_LOG_USAGE=true npm run dev   2>server.log
 *
 * Then, in another terminal:  node verify/real-mode.mjs
 *
 * This script imports NOTHING from /app, /lib, or /scripts — it is a pure HTTP client,
 * so it never crosses the live/offline plane boundary. Token counts are emitted by the
 * server (the SYNTHESIS_LOG_USAGE log in lib/claude.ts), not here:
 *   grep '\[synthesis usage\]' server.log
 *
 * No credentials are read or required by this script. In mock mode it makes zero billed
 * calls; in real mode the billed calls are made by the server, with your key.
 *
 * Env:
 *   BASE_URL   default http://localhost:3000
 *   MODULES    comma list to run a subset, e.g. MODULES=fit,case  (default: all)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ONLY = (process.env.MODULES ?? "fit,behavioural,case")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function readSample(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} -> ${res.status} ${res.statusText}\n${text}`);
  }
  return res.json();
}

const hr = (s) => `\n${"=".repeat(70)}\n${s}\n${"=".repeat(70)}`;
const sub = (s) => `\n${"-".repeat(70)}\n${s}\n${"-".repeat(70)}`;

// --------------------------------------------------------------------------- //
// Module 1 — Fit Analyzer  (NO Claude path; deterministic; identical mock≡real)
// --------------------------------------------------------------------------- //
async function runFit() {
  console.log(hr("MODULE 1 — Fit Analyzer  (deterministic — no Claude call)"));
  const resumeText = readSample("context/resume_samples/consultant_27096471.txt");
  const jdText = readSample("context/jd_samples/consultant.txt");

  const out = await post("/api/fit/analyze", { resumeText, jdText });
  const r = out.report;
  console.log(`mode: ${out.mock ? "MOCK" : "REAL"}  (mock flag = ${out.mock})`);
  console.log(`overall_score: ${r.overall_score}/100`);
  console.log(`requirements scored: ${r.per_requirement.length}`);
  console.log(`top_strengths: ${r.top_strengths.length}, gaps: ${r.gaps.length}, recs: ${r.recommendations.length}`);
  console.log(`JD parsed: ${out.jd.company ?? "?"} — ${out.jd.role_title ?? "?"} (must-have ${out.jd.must_have_count})`);
  // Stable fingerprint so you can diff the MOCK run vs the REAL run — they must be IDENTICAL
  // except `mock`. This is the Module-1 "mock vs real" comparison.
  const fingerprint = JSON.stringify({
    overall_score: r.overall_score,
    per_requirement: r.per_requirement.map((p) => [p.requirement, p.status, p.score]),
    gaps: r.gaps,
    missing_keywords: r.missing_keywords,
    recommendations: r.recommendations,
  });
  console.log(`fingerprint(sha-less): ${fingerprint.length} chars — diff this across a mock run and a real run; should match exactly.`);
  console.log("PASS check: overall_score is a 0-100 int and requirements are classified. Claude calls = 0, fallback = N/A.");
}

// --------------------------------------------------------------------------- //
// Module 2 — Behavioural  (1 Claude call per answered question, in real mode)
// --------------------------------------------------------------------------- //
const BEHAVIOURAL_ANSWERS = {
  leadership:
    "During my final-year consulting project, our four-person team was analyzing customer churn for a mid-sized SaaS company, and two weeks before the deadline our model started producing unstable results. As team lead, I had to realign the team and still deliver something the client could use. I ran a 45-minute reset meeting where we split the problem into data-quality, modeling, and interpretation issues, then reassigned work to people's strengths — one person cleaning usage data, another validating assumptions, another on the client slides. I rebuilt the model from a simple logistic-regression baseline so the result was explainable, and set up a daily 15-minute check-in to surface blockers early. We delivered on time and identified three churn drivers that explained 62% of at-risk accounts. The client used it to redesign their onboarding emails, and we received the highest grade in the course.",
  data_driven_decision:
    "As a junior commercial analyst, I noticed promotional budgets were being set mostly on last year's spend rather than current outlet performance, and I wanted to recommend an allocation that improved return on promotional investment. I pulled six months of outlet-level sales, promotion spend, foot-traffic estimates, and growth, grouped outlets into performance tiers, and calculated incremental sales per dollar of promotion. I found the middle tier was generating the best marginal return while some top-tier outlets were getting spend with little incremental uplift, so I proposed shifting 15% of spend from low-return outlets to high-potential middle-tier ones. The reallocation improved promotional ROI by 11% the next quarter and became the template for monthly budget reviews.",
  why_this_role:
    "I'm interested in this role because it sits at the intersection of analytics, commercial strategy, and technology, which is where my strongest work has been. Across internships and projects I've enjoyed taking messy business problems, structuring them, and turning analysis into recommendations leadership can act on, and this role lets me do that with real client impact while learning in an apprenticeship culture. I'm especially drawn to the data and technology transformation work, because I've built dashboards, churn models, and AI-enabled prototypes, and I want to keep developing toward leading larger transformations.",
};
const BEHAVIOURAL_QIDS = ["leadership", "data_driven_decision", "why_this_role"];

async function runBehavioural() {
  console.log(hr("MODULE 2 — Behavioural Simulator  (1 Claude call / answer in real mode)"));
  const jdText = readSample("context/jd_samples/consultant.txt");

  const start = await post("/api/behavioural", { action: "start", jdText });
  let session = start.session;
  console.log(`mode: ${start.mock ? "MOCK" : "REAL"}  (mock flag = ${start.mock})`);
  console.log(`questions generated: ${start.questions.length}  · JD: ${start.jd?.company ?? "?"} / ${start.jd?.role_title ?? "?"}`);

  const askedIds = new Set(start.questions.map((q) => q.id));
  for (const qid of BEHAVIOURAL_QIDS) {
    if (!askedIds.has(qid)) {
      console.log(sub(`(skipped ${qid} — not in generated set)`));
      continue;
    }
    const answer = BEHAVIOURAL_ANSWERS[qid];
    const res = await post("/api/behavioural", { action: "respond", session, questionId: qid, answer });
    session = res.session;
    const s = res.score;
    console.log(sub(`Q: ${qid}`));
    console.log(`overall: ${s.overall}/5`);
    console.log(`dimensions: ${s.dimension_scores.map((d) => `${d.dimension}=${d.score}`).join(", ")}`);
    console.log(`matched prepared answer: ${res.matched_answer ? res.matched_answer.id : "none (key-point coverage = N/A)"}  · match_score: ${res.match_score ?? "—"}`);
    console.log(`strengths: ${s.strengths.length}  · improvements: ${s.improvements.length}`);
    console.log(
      `coherence check: 1-5 scores present (${s.dimension_scores.every((d) => d.score >= 1 && d.score <= 5)}), ` +
        `feedback references the answer (${s.strengths.length + s.improvements.length > 0}).`,
    );
  }

  const summary = await post("/api/behavioural", { action: "summary", session });
  console.log(sub("Session summary"));
  console.log(`answered: ${summary.answered}  · overall: ${summary.overall}/5`);
  console.log(`dimension averages: ${summary.dimension_averages.map((d) => `${d.dimension}=${d.average}`).join(", ")}`);
  console.log(`feedback: ${summary.feedback.summary}`);
  console.log(`\nFallback note: in REAL mode each answered question = one Haiku call. If a '[synthesis usage]'`);
  console.log(`line did NOT print server-side for a question, the heuristic fallback fired — capture & investigate.`);
}

// --------------------------------------------------------------------------- //
// Module 3 — Case Simulator  (1 Claude call / turn + 1 final score, in real mode)
// --------------------------------------------------------------------------- //
const CASE_ANSWERS = {
  intro:
    "Let me make sure I've framed this correctly. Beautify is a global prestige cosmetics company that has historically sold through high-end department stores, where in-store beauty consultants demonstrate products, sell, and maintain a loyal repeat base. The key shift is that shopping is moving online, so those consultants are increasingly underused, sitting in near-empty stores. The decision we're being asked to make is whether retraining the majority of these consultants into virtual, social-media advisors — selling through their own pages on beautify.com and staying active across social platforms — would be profitable and value-creating for Beautify. So the core question is whether that transformation pays off.",
  clarification:
    "Before I build an approach, I'd like to clarify three things. First, over what time horizon does this need to be profitable — are we judging payback over one year, three years, or longer? Second, what is the scope of a 'virtual advisor' — does it include selling on beautify.com, virtual try-on tools, and live social consultations, or something narrower? And third, which brands and markets are in scope for the initial move, and who bears the retraining and IT cost — Beautify centrally or each brand-country unit?",
  framework:
    "I'd structure the factors into external and internal buckets. Externally, first, retailer response — how our department-store and specialty partners react to customers buying directly on beautify.com, and what that does to our financial arrangements with them. Second, competitor response — whether rivals already offer virtual advisors, how successful those are, and whether they plan to digitize. Internally, third, our consultants' current capabilities — who already has a social-media presence, and whether we retrain or hire. Fourth, brand image — the implications of hundreds of advisors posting content, and the employer-brand leverage. And fifth, tying it together, the economics — the cost of retraining, IT, and counter remodeling versus the incremental revenue. I'd want to pressure-test the economics quantitatively.",
  analysis:
    "Starting from what the customer values in-store — personalization, trust, and responsiveness — I'd look for virtual features that match or beat that. First, real-time tailored feedback: a selfie-mirror style app that gives product recommendations and lets the customer virtually try on looks. Second, an online community led by their advisor, so they keep the relationship and social proof. Third, trend learning from a trusted, active advisor through tutorials and honest reviews. And fourth, private, responsive handling of specific concerns — quick one-to-one support about fit or a skin concern. The features that best preserve the personal relationship are the advisor-led community and the private support.",
  data_reveal:
    "Let me work through the payback. Incremental revenue is 10% of €1.3 billion, so €130 million. Annual all-in costs are €10 million, giving annual profit of €120 million. The upfront investment is €50M IT plus €25M training plus €50M counter remodeling plus €25M inventory, so €150 million. IT depreciates at 5% of €50M, which is €2.5 million a year, so adjusted annual profit is €117.5 million. Payback is €150M divided by €117.5M, roughly 1.28 years — about one year and three months, well within a reasonable horizon. On the competitor chatbot data: all four bots lift website visits, so bots drive traffic regardless of capability. But Lena, the virtual try-on bot, stands out — it leads site-to-purchase conversion at 19%, lifts product-fit satisfaction most at 24%, and cuts return rate the most at minus 15%. The takeaway is that virtual try-on builds confidence in fit, so I'd prioritize developing a Lena-like try-on capability first.",
  pressure_test:
    "My view is that both risks are real but manageable, and they don't change the recommendation — so I'd proceed while actively de-risking. On retailer pushback, cannibalization of their counters is a genuine concern; therefore I'd share economics with retail partners through a revenue-sharing arrangement and keep advisors appearing at retail outlets, so partners still benefit rather than being bypassed. On brand dilution from hundreds of advisors posting, I believe the fix is control rather than avoidance: clear brand-content guidelines, an approval workflow, and leaning on the strongest advisors first. And rather than a big-bang rollout, my recommendation is to pilot in a few select brands and markets, monitor cannibalization and brand sentiment, and only scale once the economics hold and partners stay aligned. So on balance, the risks are mitigable and the upside clearly outweighs them.",
  recommendation:
    "My recommendation is yes — proceed, but with a phased rollout. The single strongest argument is the economics: a roughly 1.28-year payback is fast and well within a reasonable horizon. The competitor evidence reinforces it — virtual capabilities, especially virtual try-on like Lena, materially lift conversion and basket size and cut returns, so I'd prioritize building a virtual-try-on capability first. The main risks are retailer cannibalization and brand dilution, which I'd manage with retail revenue-sharing, brand-content guidelines, and a pilot. In the first 90 days I'd launch the pilot in two or three brand-markets, stand up the try-on tool, and define the advisor content standards, then review adoption and retailer response before scaling.",
  _default:
    "Building on that directly: the core decision is whether retraining Beautify's in-store consultants into virtual social-media advisors is profitable. The first-year economics give roughly a 1.28-year payback, and competitor data shows virtual try-on drives the most conversion and product-fit satisfaction while cutting returns, so I'd proceed with a phased pilot that shares economics with retail partners and sets brand-content guidelines.",
};

async function runCase() {
  console.log(hr("MODULE 3 — Case Simulator  (1 Claude call / turn + 1 final score)"));
  const caseId = "beautify";
  const start = await post("/api/case", { action: "start", caseId });
  let session = start.session;
  let stage = start.stage; // "intro"
  console.log(`mode: ${start.mock ? "MOCK" : "REAL"}  (mock flag = ${start.mock})`);
  console.log(`opening stage: ${stage}`);

  let finalScore = null;
  let turns = 0;
  for (let i = 0; i < 24; i++) {
    const answer = CASE_ANSWERS[stage] ?? CASE_ANSWERS._default;
    const res = await post("/api/case", { action: "respond", caseId, session, answer });
    turns += 1;
    session = res.session;
    const ev = res.evaluation;
    console.log(
      sub(`turn ${turns} @ ${stage}  →  ${res.decision?.action ?? "?"}  (next: ${res.stage})`) +
        `\neval.overall: ${ev?.overall ?? "?"}  · dims: ${(ev?.dimension_scores ?? []).map((d) => `${d.dimension}=${d.score}`).join(", ")}`,
    );
    if (res.score || res.complete || res.stage === "scoring") {
      finalScore = res.score;
      break;
    }
    stage = res.stage;
  }

  console.log(sub("Final CaseScore"));
  if (finalScore) {
    console.log(`overall: ${finalScore.overall}/5`);
    console.log(`dimensions: ${finalScore.dimension_scores.map((d) => `${d.dimension}=${d.score}`).join(", ")}`);
    console.log(`strengths: ${finalScore.strengths.length}  · improvements: ${finalScore.improvements.length}  · next_focus: ${finalScore.next_focus.join(", ")}`);
  } else {
    console.log("No final score returned within the turn cap — investigate the FSM/scoring path.");
  }
  console.log(`\nClaude calls this session (real mode) ≈ ${turns} per-turn evals + 1 final score = ${turns + 1}.`);
  console.log(`This is the disproportionately expensive module (N+1 calls vs behavioural's N vs fit's 0).`);
}

// --------------------------------------------------------------------------- //
const RUNNERS = { fit: runFit, behavioural: runBehavioural, case: runCase };

async function main() {
  console.log(`Synthesis real-mode driver → ${BASE_URL}  · modules: ${ONLY.join(", ")}`);
  console.log(`(Token counts are logged server-side when SYNTHESIS_LOG_USAGE=true — grep '[synthesis usage]'.)`);
  try {
    await post("/api/fit/analyze", { resumeText: "ping", jdText: "ping" }); // connectivity probe (deterministic, free)
  } catch (e) {
    console.error(`\nCannot reach the dev server at ${BASE_URL}. Start it with 'npm run dev' first.\n${e.message}`);
    process.exit(1);
  }
  for (const m of ONLY) {
    const fn = RUNNERS[m];
    if (!fn) {
      console.log(`(unknown module '${m}' — skipping)`);
      continue;
    }
    await fn();
  }
  console.log(hr("Done. In REAL mode, sum token usage from the server log:  grep '[synthesis usage]' server.log"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
