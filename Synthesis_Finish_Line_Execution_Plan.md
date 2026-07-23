# Synthesis — Finish-Line Execution Plan

*Solo completion plan from deployed MVP to final submission*

> **Note:** This is the markdown mirror of `Synthesis_Finish_Line_Execution_Plan.docx`
> (dated 13 July 2026), committed so cloud agents can read it. If this file and the
> `.docx` diverge, treat the most recently edited one as authoritative and reconcile.

**Current baseline:** PR #10 is merged and deployed to Production. The live Fit
Analyzer selects `hybrid_0_25` when embeddings are enabled. Behavioural voice and
the Case module have both passed live smoke tests. The remaining work is not a new
architecture build. It is reliability hardening, UX integration, human validation,
documentation, and final presentation preparation.

- **Prepared for:** Feroz Khan
- **Final submission target:** 30 July 2026

---

## Current Status at Codex Handoff — July 14, 2026

This document was originally prepared before completion of the v3 cockpit UX. The
original phase descriptions and schedule are retained below as a historical
execution record, but the following status overrides them for all future work.

**Completed and deployed**

- Phase A, the v3 UX refresh, is complete.
- PR #11 has been merged into `main`.
- The updated application is deployed on Vercel.
- The following routes are implemented and live:
  - `/`
  - `/onboard`
  - `/dashboard`
  - `/fit`
  - `/behavioural`
  - `/case`
- The v3 implementation includes:
  - landing and onboarding flows;
  - dashboard and unified readiness presentation;
  - dark and light themes;
  - localStorage-backed presentation state;
  - refreshed Fit, Behavioural, and Case interfaces.

**Do not redesign or recreate Phase A.**

**Current priorities**

Work should proceed in this order:

1. Phase B — embedding truthfulness and honest Fit fallback reporting.
2. Phase C — reproducible human-validation package.
3. Phase D — bounded module-level UX hardening without redesigning the v3 system.
4. Phase F — documentation and source-of-truth alignment.
5. Phase E — final integrated verification after all approved pull requests merge.

**Superseded or descoped directions**

Unless explicitly reauthorized:

- Do not implement O*NET vector-database RAG.
- Do not introduce centralized database persistence or choose a provider.
- Do not add authentication or user accounts.
- Do not replace the local O*NET dictionary.
- Do not change API contracts or case FSM behaviour.
- Do not replace the Anthropic SDK or the configured Claude models.
- Do not treat this document's original July UX schedule as current work.

All agents must follow `AGENTS.md` and the task-specific file boundaries supplied in
their assignment.

---

## 0. How to use this document

This plan is designed to be executed in order. Each phase has a purpose, exact
tasks, acceptance criteria, and a stop condition. Do not skip forward because later
work depends on earlier stability.

**Recommended execution order**

1. Freeze scope and create a clean source-of-truth branch.
2. Integrate the Claude Design UX without touching scoring or interview logic.
3. Harden and verify the embedding runtime so hybrid scoring is truthful.
4. Complete a small but defensible human-validation study.
5. Polish voice reliability and module-level user experience.
6. Run full regression, accessibility, performance, and demo testing.
7. Produce final report evidence, slides, screenshots, and a rehearsed demonstration.
8. Freeze the codebase and submit.

**Sections**

1. Executive decision and finish-line definition
2. Current project state
3. Scope freeze: what is in and what is out
4. Phase A — Safe UX/UI integration
5. Phase B — Embedding runtime reliability
6. Phase C — Human validation
7. Phase D — Voice and module polish
8. Phase E — Full verification and quality gates
9. Phase F — Final report, progress reports, and presentation
10. Day-by-day schedule to 30 July
11. Risk register and contingency decisions
12. Final acceptance checklist
- Appendix A — Claude Code prompts
- Appendix B — Final demo script and evidence capture plan

---

## 1. Executive decision and finish-line definition

**Primary decision**

You should finish Synthesis by yourself through controlled Claude Code sessions,
but you should not treat "finishing" as adding every feature previously discussed.
The finish line is a stable, validated, visually coherent three-module MVP with
honest documentation and a reliable final demo.

**The product is finished when all six conditions are true**

| Condition | Definition of done |
|---|---|
| Product works | Fit, Behavioural, and Case complete their core user journeys in Production without crashes. |
| Scores are truthful | The API never labels mock-vector output as real hybrid scoring; fallback behaviour is explicit. |
| UX is coherent | The Claude Design system is applied consistently across the landing page and all three modules without breaking functionality. |
| Evidence exists | Automated tests, live smoke tests, human validation, screenshots, and reproducible methodology are documented. |
| Claims are honest | The report distinguishes implemented, mocked, validated, and descoped components. |
| Demo is rehearsed | A 7–10 minute guided demonstration succeeds twice in a row on the deployed site. |

**Your operating principle**

From this point onward, every change must either improve final-demo reliability,
strengthen analytical credibility, improve usability, or produce submission
evidence. Anything else is scope creep.

---

## 2. Current project state

**Baseline as of 13 July 2026**

| Area | Current status | What remains |
|---|---|---|
| Fit Analyzer | Hybrid path deployed; local O*NET dictionary; structured fallback exists. | Verify real BGE backend, fix silent mock fallback, complete pair-level human validation, apply UX design. |
| Behavioural | Question flow and scoring work; speech-to-text is merged and passed a live smoke test. | Improve mic states, accent/error handling, transcript editing, visual polish, and final demo script. |
| Case | FSM, exhibits, scoring, and live flow work. | UX polish, content sanity check, final-state explanation, and demo rehearsal. |
| Deployment | Current Production deployment is Ready on main at PR #10 merge commit. | Add runtime observability and complete final verification after every remaining PR. |
| Validation | Offline scoped evidence supports `hybrid_0_25` as the best pre-specified candidate. | Human-labelled JD-resume pair study and concise methodology/limitations write-up. |
| Persistence | No production user accounts or backend storage. | Remain descoped. Optional browser-local storage only after all critical gates pass. |
| Documentation | Several old plans conflict with the merged architecture. | Create one source of truth and update report language to reflect the O*NET RAG pivot. |
| UX/UI | A new design is waiting in Claude Design. | Translate it into a reusable design system and integrate it safely, module by module. |

**Important architectural truth**

- O*NET RAG and remote vector-database retrieval are not part of the MVP architecture.
- O*NET is a committed local occupational dictionary, not a retrieval service.
- Authentication and centralized persistence are not required to finish the
  product; the future database provider is undecided.
- The public Fit Analyzer currently uses `hybrid_0_25` when `EMBEDDINGS_ENABLED=true`,
  but the backend identity still needs to be made observable and truthful.
- The strongest remaining academic gap is human validation, not another feature.

---

## 3. Scope freeze: what is in and what is out

**In scope — required before final submission**

- Claude Design UX integration across the landing page and the three module pages.
- A reusable visual system: typography, spacing, cards, buttons, state colours,
  alerts, and responsive layout.
- Truthful embedding backend reporting and structured fallback on BGE failure.
- Automated test for forced embedding failure.
- Human-labelled validation of representative JD-resume pairs.
- Voice-state polish: listening, permission denied, unsupported browser, no-speech,
  and manual fallback.
- Full live regression of all three module journeys.
- Final source-of-truth documentation, report narrative, progress reports, slides,
  screenshots, and demo script.

**Optional — only after all required work is green**

- Resume or JD file upload, provided it uses existing parsing logic and does not
  threaten stability.
- Browser-local persistence of recent reports or session drafts.
- Minor copywriting and animation polish.
- One additional behavioural question set or case only if current content quality
  is already verified.

**Explicitly out of scope**

- Authentication, user accounts, and centralized database persistence.
- O*NET vector-database RAG, ingestion pipelines, or n8n workflows.
- Payments, subscriptions, dashboards, job-board integrations, and saved cloud histories.
- Model fine-tuning or new model-provider integrations.
- A fully conversational speech-to-speech interviewer.
- New architecture work that changes core scoring contracts.

**Scope-control rule**

When a new idea appears, ask: "Will this be visible, testable, and valuable in the
final presentation?" If the answer is not clearly yes, record it under Future Work
and do not build it.

---

## 4. Phase A — Safe UX/UI integration

*Start here because you already have a design waiting in Claude Design.*

**Objective**

Apply the new visual design without altering scoring logic, API contracts, FSM
behaviour, retrieval, model configuration, or validation code. The UX work must be
a presentation-layer change first.

**Step A1 — Capture the design reference**

- Open the final Claude Design artifact and save full-page screenshots for desktop
  and mobile views.
- Capture each important state: landing page, Fit input, Fit result, Behavioural
  listening, Behavioural result, Case active stage, exhibit, and final score.
- Place the screenshots in a local folder outside the app source first. Use a name
  such as `~/Desktop/Synthesis-UX-Reference`.
- Write a one-page visual specification: colour palette, typography hierarchy,
  spacing scale, border radius, card style, button states, icon style,
  empty/loading/error states, and responsive behaviour.
- Do not copy generated placeholder text or fake product claims into the live app.

**Step A2 — Create a dedicated branch**

```bash
cd ~/synthesis-local
git switch main
git pull --ff-only
git status --short
git switch -c feroz/ux-final-integration
```

If `git status` shows tracked modifications, stop and preserve them before creating
the branch. Previously known untracked report files can remain untracked, but do
not accidentally include them in the UX commit.

**Step A3 — Ask Claude Code to plan before editing**

> You are the senior frontend engineer for Synthesis. I have attached screenshots
> from the approved Claude Design concept. First perform a read-only audit of the
> current Next.js app and map each design element to the existing component
> structure. Do not edit files yet.
>
> Non-negotiable constraints:
> - Preserve all APIs, scoring logic, response contracts, FSM transitions, voice hooks, and module behaviour.
> - Do not modify `lib/matching*`, `lib/embeddings.ts`, validation scripts, API route logic, or add provider-specific database files.
> - Reuse existing content and real application states. Do not add fake metrics or placeholder functionality.
> - Keep the app responsive and accessible.
> - Prefer reusable components and design tokens over page-specific duplication.
> - The branch is presentation-layer only.
>
> Produce: 1. A file-by-file implementation plan. 2. A proposed component inventory.
> 3. The design tokens to add. 4. Risks and regressions to watch. 5. A phased order:
> shared shell, landing page, Fit, Behavioural, Case, responsive pass. 6. Exact
> verification commands. Stop after the plan and wait for approval.

**Step A4 — Implement in controlled slices**

| Slice | Work | Gate before continuing |
|---|---|---|
| A | Design tokens, global typography, spacing, background, buttons, cards, navigation, and layout shell. | Build passes; all routes still render; no logic files changed. |
| B | Landing page and product explanation. | Links to all three modules work; mobile view is clean. |
| C | Fit input, loading state, results hierarchy, method/fallback messaging, requirement cards. | Strong/weak/empty API tests still work; data is not hidden by design. |
| D | Behavioural question, mic, text editor, scoring, and summary states. | Voice and manual input both work; denied-mic state is understandable. |
| E | Case stage navigation, exhibit presentation, response input, and final score. | FSM advances correctly; exhibits remain legible. |
| F | Responsive and accessibility pass. | Keyboard navigation, focus indicators, labels, contrast, and 375px mobile width pass. |

**UX acceptance criteria** *(all "Not started")*

| Task | Evidence required |
|---|---|
| One coherent visual system is used across every page. | Side-by-side screenshots of all four main routes. |
| Every existing core action remains functional. | Live smoke-test notes. |
| Loading, success, warning, empty, and error states are visible and readable. | Screenshots of each state. |
| The Fit method and fallback explanation remain visible. | Result screenshot and API response. |
| Voice has clear listening, stopped, denied, and unsupported states. | Chrome test notes. |
| The app works at desktop and mobile widths. | Responsive screenshots. |
| No scoring, FSM, embedding, or validation code changed in the UX branch. | `git diff --name-only` and review. |

**Do not merge the entire redesign in one blind pass.** A beautiful redesign that
breaks one module is worse than the current UI. Commit each slice separately, run
the gates, and preserve an easy rollback point.

---

## 5. Phase B — Embedding runtime reliability

**Objective**

Make the live Fit score honest. A request may report `hybrid_0_25` only when real
semantic embeddings were produced. Any model-load or inference failure must return
structured scoring with a visible fallback reason.

**Required implementation behaviour**

| Runtime state | Required API behaviour | Required UI message |
|---|---|---|
| Embeddings disabled | `method=structured`; `backend=disabled`; fallback reason explains configuration. | Structured scoring is active. |
| BGE loaded successfully | `method=hybrid_0_25`; `backend=bge`; `fallback_reason=null`. | Hybrid: 25% rules / 75% semantic. |
| BGE load fails | `method=structured`; `backend=failed`; `fallback_reason` contains a safe error category. | Semantic model unavailable; structured fallback used. |
| Inference fails after load | `method=structured`; `backend=failed`; request still returns 200 unless input is invalid. | Analysis completed using structured fallback. |
| Mock mode in tests | `backend=mock` only in explicitly marked test/mock contexts; never presented as production semantic scoring. | No production hybrid claim. |

**Create the branch after UX merges**

```bash
git switch main
git pull --ff-only
git switch -c feroz/embedding-runtime-truth
```

**Claude Code prompt — embedding hardening**

> Audit and harden the production embedding path in Synthesis.
>
> Problem: The current `embed()` function may catch a real model load or inference
> failure, return mock vectors, and allow the API to report `method=hybrid_0_25`
> with `fallback_reason=null`. This is unacceptable in Production.
>
> Implement the smallest safe change that guarantees:
> 1. Production `hybrid_0_25` is reported only when real BGE embeddings were used.
> 2. Any real embedding load/inference failure falls back to `scoreFit()` and reports `method=structured`.
> 3. The response exposes a backward-compatible field such as `embedding_backend: bge | disabled | failed | mock`.
> 4. `fallback_reason` is populated with a safe, non-secret reason when fallback occurs.
> 5. One concise server log confirms BGE load success; one concise warning records a categorized failure.
> 6. Mock vectors remain available only for deterministic tests or explicit mock mode and can never be mislabeled as real semantic output.
> 7. Add focused tests for embeddings disabled, BGE success through a mocked real embedder, forced load failure, forced inference failure, and API response compatibility.
> 8. Do not add auth, persistence, provider-specific database work, or unrelated refactors.
>
> Also assess the Vercel runtime packaging of `@xenova/transformers` and propose the
> least risky deployment approach. Run typecheck, all tests, and build. Stop before
> committing and give me a pre-merge report.

**Deployment verification after merge**

- Deploy the branch to Preview first with `EMBEDDINGS_ENABLED=true`.
- Submit the same Fit pair three times and confirm `backend=bge`, `method=hybrid_0_25`, and no fallback reason.
- Run a controlled failure test in Preview using an invalid model setting only if the implementation supports a safe test configuration.
- Confirm the response becomes structured with `backend=failed` and a clear fallback reason.
- Merge to main only after Preview behaviour is truthful.
- Redeploy Production and repeat one successful request.
- Record screenshots of the API response and logs as report evidence.

**Stop condition**

If BGE cannot be packaged or initialized reliably on Vercel Hobby within the
available time, keep embeddings disabled in Production and present hybrid scoring as
a validated local/offline capability with structured production fallback. That is an
honest, defensible capstone decision.

---

## 6. Phase C — Human validation

**Objective**

Produce a small, transparent study that tests whether Synthesis scores align with
human judgement at the actual JD-resume pair level. This is more important
academically than adding storage or another feature.

**Minimum viable study design**

| Element | Recommended design |
|---|---|
| Sample size | 24 pairs minimum; 30–36 preferred. Use a balanced mix of high, medium, and low analyzer scores. |
| Coverage | Include IT, Finance, and Consultant postings, plus several cross-family mismatches. |
| Blinding | Hide the Synthesis score and method while assigning human ratings. |
| Rubric | Rate core skills, domain/experience, seniority/years, and education/hard constraints on 0–2 each. |
| Outcome | Total 0–3 = Weak, 4–6 = Medium, 7–8 = Strong. |
| Comparison | Compare human category with structured and hybrid scores; examine monotonicity, rank agreement, and major disagreements. |
| Limitations | One primary reviewer, small scoped sample, proxy labels, and no claim of hiring suitability certification. |

**Validation worksheet columns**

Pair ID · Posting family · Resume family · Analyzer method · Analyzer score ·
Core skills rating 0–2 · Experience/domain rating 0–2 · Seniority/years rating 0–2 ·
Education/hard constraints rating 0–2 · Human total 0–8 ·
Human category (Weak / Medium / Strong) · Agreement (Yes / Partial / No) ·
Reason for disagreement · Parser or evidence issue observed

**Recommended process**

1. Create the pair sample before looking at human labels. Stratify by analyzer score band.
2. Export the JD and resume text into a clean review sheet with analyzer scores hidden.
3. Rate every pair with the same rubric in one or two focused sessions.
4. Reveal the analyzer scores only after all human ratings are complete.
5. Calculate category agreement and identify the five largest disagreements.
6. Classify each disagreement as parser issue, missing evidence, semantic over-match, structured over-penalty, or legitimate ambiguity.
7. Do not tune hybrid weights on this small final sample. Use the study to validate and discuss limitations, not to chase a better headline number.
8. Write a one-page methodology and results summary for the final report.

**Success criteria**

- Human categories generally increase as Synthesis scores increase.
- Most major disagreements can be explained and documented.
- No systematic leakage or obvious family-label shortcut appears.
- The report states what the study supports and what it cannot prove.
- The same saved input pairs can be rerun for the presentation if asked.

**Do not claim**

The Fit score does not certify whether someone should be hired, and the scoped
study does not establish universal job-fit accuracy. It demonstrates that the
ranking and evidence are directionally useful within the tested scope.

---

## 7. Phase D — Voice and module polish

**Behavioural voice checklist** *(all "Not started")*

| Task | Evidence required |
|---|---|
| Mic permission request is clear and recoverable. | Screenshot of permission and denied states. |
| Listening state is visually obvious. | Listening screenshot or recording. |
| Transcription appends predictably and remains editable. | Three-answer test notes. |
| Manual typing remains fully functional. | Text-only test. |
| No-speech and recognition-error states do not block the session. | Forced error test. |
| Unsupported browsers receive a useful message. | Code path and UI screenshot. |
| Accent sensitivity is documented honestly. | Ten short-answer observation table. |
| The final demo uses a rehearsed sentence that transcribes reliably. | Demo script. |

**Case module polish checklist** *(all "Not started")*

| Task | Evidence required |
|---|---|
| Current stage and next action are unmistakable. | Active-stage screenshot. |
| Exhibits are legible and contextualized. | Exhibit screenshot at desktop width. |
| Response entry and submit actions are consistent. | Journey test. |
| Loading and evaluation states are visible. | State screenshot. |
| Final score explains dimensions and next steps. | Final-state screenshot. |
| A complete case can be demoed in under four minutes using prepared responses. | Timed rehearsal. |
| No dead-end state exists after refresh or invalid input. | Negative test notes. |

**Fit module polish checklist** *(all "Not started")*

| Task | Evidence required |
|---|---|
| The user understands what text to paste and what the score means. | Input helper text and result explanation. |
| Method and fallback state are visible but not overwhelming. | Result screenshot. |
| Requirement evidence is scannable. | Desktop and mobile screenshots. |
| Gaps and recommendations are separated clearly. | Result screenshot. |
| Empty and malformed input produce useful guidance. | Negative test notes. |
| The score is framed as decision support, not certification. | Copy review. |

**Optional local persistence**

Only add localStorage after all required tasks pass. A small feature may save the
most recent Fit input/result or behavioural draft in the browser. Do not add
accounts, cloud storage, or synchronization.

**Recommendation:** Unless local persistence is explicitly visible in the final
presentation, skip it. The final two weeks should favour reliability and evidence
over another state-management pathway.

---

## 8. Phase E — Full verification and quality gates

**Automated gates after every functional PR**

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Record test count, failures, skipped tests, warnings, and approximate runtime. Do
not accept "it builds on my machine" without the full gate set.

**Production journey matrix**

| Journey | Positive test | Negative/edge test | Evidence |
|---|---|---|---|
| Landing | All module cards open the correct route. | Mobile width and direct URL refresh. | Screenshot and route list. |
| Fit | Strong, medium, and weak pairs return complete results. | Empty text, malformed text, BGE failure, embeddings disabled. | API responses and screenshots. |
| Behavioural | Start, answer, score, continue, and summary. | Mic denied, no speech, manual-only, refresh. | Recording and notes. |
| Case | Start, progress, exhibit, score, complete. | Invalid response, refresh, repeated submit. | Recording and notes. |
| Navigation | Home/back links and page refresh work. | Open direct route in new browser session. | Checklist. |
| Responsive | Desktop, tablet, and mobile layouts remain usable. | Long text and narrow width. | Screenshots. |
| Accessibility | Keyboard use, labels, focus, contrast, headings. | Screen-reader-friendly status copy. | Audit notes. |

**Performance and operational checks**

- Measure the first Fit request after a cold deployment and a second warm request.
- Check Vercel logs for timeouts, memory errors, module-not-found errors, and repeated model initialization.
- Confirm no secrets or API keys appear in logs or client bundles.
- Verify the model package is server-only and is not included in client JavaScript.
- Confirm the deployment still works without an Anthropic credential where mock mode is intended.
- Check that the public demo does not expose internal validation files or local paths.

**Code review checklist before merging any remaining branch**

- Diff is limited to the stated task.
- No unrelated architecture changes.
- Tests cover the new failure path.
- User-facing copy matches actual runtime behaviour.
- No secrets, generated model files, or large accidental artifacts.
- Rollback is straightforward.
- Preview deployment has been manually tested.
- Main is updated before the next branch is created.

---

## 9. Phase F — Final report, progress reports, and presentation

**Single source of truth**

Create one document titled *Synthesis MVP Source of Truth — 13 July 2026*. Mark the
June handoff and O*NET RAG plans as superseded. Every progress report, slide, and
oral claim should follow the current source of truth.

**Final report structure**

| Section | What to include |
|---|---|
| 1. Problem and user need | Why interview practice lacks objective, affordable feedback; target users and use cases. |
| 2. Product overview | Three modules and the end-to-end user journey. |
| 3. Architecture | Next.js/Vercel, model usage, local O*NET dictionary, scoring paths, FSM, voice input. |
| 4. Data and validation | Datasets, leakage controls, scoped validation, hybrid choice, human pair study. |
| 5. Implementation | Major PRs, module contracts, mock vs real paths, deployment. |
| 6. UX and accessibility | Design system, responsive behaviour, error states, voice fallback. |
| 7. Results | Automated tests, live journey results, validation outcomes, screenshots. |
| 8. Limitations | Scoped families, voice accent sensitivity, Vercel/runtime constraints, no user accounts. |
| 9. Pivot and learning | Why the earlier O*NET RAG/Supabase pgvector approach was explored and abandoned. |
| 10. Future work | Persistence, broader validation, file upload, richer voice, cloud accounts. |
| 11. Team/process reflection | Role allocation, validation-driven decisions, source control, deployment lessons. |

**Required evidence package**

- Final production URL and merge commit.
- Screenshot of landing page and one key state from each module.
- Fit API response showing method, backend, and fallback state.
- Vercel logs showing successful requests.
- Automated test summary and build result.
- Validation table and one chart showing human category versus score band.
- Architecture diagram showing what is local, hosted, mocked, and descoped.
- Before/after UX screenshots.
- One short voice test table documenting accent sensitivity and fallback.
- A clear limitations table.

**Progress report — 20 July**

- PR #10 merged and deployed; hybrid path enabled.
- Behavioural voice and Case live smoke tests completed.
- UX integration branch in progress or merged.
- Embedding backend truth/fallback fix in progress or merged.
- Human-validation sample prepared and rating underway.
- The earlier O*NET RAG and Supabase persistence approach was formally abandoned.
- Risks: BGE serverless reliability, limited human-validation sample, accent sensitivity.

**Progress report — 26 July**

- Final UX merged and production-tested.
- Truthful embedding fallback verified.
- Human validation completed and summarized.
- Full test/build/regression suite green.
- Final report and slides substantially complete.
- Demo recorded or rehearsed twice.
- Code freeze in effect; only critical fixes permitted.

**Presentation narrative**

- Open with the user problem and the three-module solution.
- Demonstrate Fit first because it contains the strongest analytical contribution.
- Explain hybrid scoring in plain language and show evidence, not implementation detail.
- Demonstrate Behavioural voice as an interaction enhancement, while keeping manual fallback visible.
- Demonstrate one short Case sequence and the scoring summary.
- Show the validation and architecture pivot as evidence of responsible product decision-making.
- Close with limitations and realistic next steps.

---

## 10. Day-by-day schedule to 30 July

| Date | Primary objective | Required output |
|---|---|---|
| 13 Jul | Baseline complete. | Main updated; Production deployed; all three live smoke tests completed. |
| 14 Jul | Capture Claude Design and plan integration. | Reference screenshots, visual specification, read-only implementation plan. |
| 15 Jul | Build shared design system and landing page. | Tokens/components commit; build and routes green. |
| 16 Jul | Integrate Fit design. | Fit input/result states polished; API regression green. |
| 17 Jul | Integrate Behavioural and Case design. | Voice and FSM journeys still work. |
| 18 Jul | Responsive/accessibility pass and UX Preview. | Desktop/mobile screenshots; UX PR ready. |
| 19 Jul | Merge UX; start embedding hardening. | UX in Production; embedding branch and tests underway. |
| 20 Jul | Progress Report 3/4 milestone. | Report submitted; embedding Preview verified; validation sample frozen. |
| 21 Jul | Complete embedding reliability. | Truthful fallback PR merged and Production evidence captured. |
| 22 Jul | Human validation ratings. | At least 24 blind-rated pairs complete. |
| 23 Jul | Analyze human validation. | Agreement summary, disagreement taxonomy, methodology note. |
| 24 Jul | Full regression and content polish. | All automated gates green; bug list reduced to zero blockers. |
| 25 Jul | Report and slides. | Draft report, architecture diagram, results visuals, demo script. |
| 26 Jul | Progress report milestone and code freeze. | Second report submitted; final feature freeze. |
| 27 Jul | Final report revision. | Claims/evidence/limitations consistent. |
| 28 Jul | Presentation rehearsal and backup demo. | Two successful rehearsals; screen recording or screenshots ready. |
| 29 Jul | Final QA and submission packaging. | Links, files, permissions, naming, and production URL checked. |
| 30 Jul | Present and submit. | No last-minute feature changes. |

**Schedule recovery rule**

If you lose a day, remove optional persistence and file upload first. Do not reduce
embedding truthfulness, human validation, regression testing, or presentation
rehearsal.

---

## 11. Risk register and contingency decisions

| Risk | Likelihood | Impact | Trigger | Response |
|---|---|---|---|---|
| BGE fails or times out on Vercel | Medium-High | High | `backend` is not `bge`, cold request times out, or model reloads repeatedly. | Use structured production fallback; keep hybrid as validated local capability; document clearly. |
| UX redesign breaks module logic | Medium | High | Regression failure or changed API/FSM files. | Revert slice; keep design-layer-only commits; merge module by module. |
| Human validation is too small | Medium | Medium | Fewer than 24 pairs by 23 Jul. | Complete 18 minimum with honest limitation; do not tune weights. |
| Voice fails for accent or browser | High | Medium | Poor transcription or unsupported browser. | Keep manual input prominent; use rehearsed demo sentence; document limitation. |
| Scope creep | High | High | New auth, persistence, upload, or data pipeline work starts before gates are green. | Move to Future Work; enforce code freeze. |
| Report claims conflict with code | Medium | High | Stale O*NET RAG or provider-specific database language remains. | Use single source of truth and final claim audit. |
| Vercel redeploy introduces regression | Low-Medium | High | Production test fails after merge. | Use Preview first; preserve last known-good deployment; roll back. |
| Last-minute demo network failure | Medium | High | Production unavailable or slow. | Prepare screenshots and a short screen recording; keep local app ready if permitted. |

**Decision ladder when something fails**

1. Fix the smallest local defect if it can be completed and tested within two hours.
2. If the defect affects an optional feature, remove or disable the feature.
3. If the defect affects hybrid embeddings, fall back truthfully to structured scoring.
4. If the defect affects voice, keep manual text input and document the limitation.
5. If the defect affects UX only, restore the last known-good design commit.
6. Never hide a failure by relabelling mock or fallback behaviour as the intended production path.

---

## 12. Final acceptance checklist

**Product** *(all "Not started")*

| Task | Evidence required |
|---|---|
| Landing page and all routes are live. | Production URL check. |
| Fit completes strong, medium, weak, empty, and fallback cases. | Test matrix. |
| Behavioural completes voice and manual journeys. | Recording and notes. |
| Case completes a full journey and final score. | Recording and notes. |
| No blocker appears in Vercel logs. | Log screenshot. |
| Responsive design works on desktop and mobile. | Screenshots. |

**Technical** *(all "Not started")*

| Task | Evidence required |
|---|---|
| Typecheck passes. | Command output. |
| All tests pass with recorded count. | Command output. |
| Production build passes. | Command output. |
| Hybrid is reported only with real BGE backend. | API response. |
| Fallback is structured and explicit. | Forced-failure test. |
| No secrets or accidental large artifacts are committed. | Diff and repository scan. |
| Main is clean and deployment matches final commit. | `git status`, `git log`, Vercel deployment. |

**Analytical and academic** *(all "Not started")*

| Task | Evidence required |
|---|---|
| Human validation is complete or honestly bounded. | Labelled sheet and summary. |
| Metrics use clearly named datasets and tasks. | Results table. |
| 12%/33% and 54.7%/65.2%/68.0% figures are not mixed without context. | Final metric audit. |
| Limitations and non-claims are explicit. | Report section. |
| The O*NET RAG pivot is documented as explored and descoped. | Architecture/process section. |
| Real, mock, fallback, and future components are distinguished. | Architecture diagram and report. |

**Submission and presentation** *(all "Not started")*

| Task | Evidence required |
|---|---|
| Final report is proofread and consistently formatted. | Final file. |
| Slides match the final report and code. | Slide review. |
| Demo script is timed and rehearsed twice. | Timing notes. |
| Backup screenshots or recording are available. | Backup folder. |
| Repository, deployment, and file links are accessible. | Permission check. |
| No feature changes occur after code freeze except critical fixes. | Git history. |

---

## Appendix A. Claude Code prompts

**Prompt 1 — Final UX implementation after plan approval**

> Implement the approved Synthesis UX plan in the current branch. Rules:
> - Work in small commits/slices: shared design system, landing, Fit, Behavioural, Case, responsive/accessibility.
> - Do not modify scoring, embeddings, API contracts, FSM logic, validation scripts, or data.
> - Preserve all existing user journeys and visible runtime method/fallback information.
> - Use the approved Claude Design screenshots as reference, not as permission to invent functionality.
> - After each slice run typecheck and focused tests. At the end run the full test suite and build.
> - Start the app and smoke-test `/`, `/fit`, `/behavioural`, and `/case` at desktop and mobile widths.
> - Report every changed file, any design deviation, test results, and remaining risks.
> - Stop before committing if any functional regression appears.

**Prompt 2 — Generate a human-validation sample and worksheet**

> Inspect the committed scoped validation inputs and the current Fit Analyzer
> without changing production code. Create a reproducible human-validation package
> for 24–36 JD-resume pairs: balanced across high, medium, and low analyzer score
> bands; covering IT, Finance, Consultant, and several cross-family mismatches;
> anonymized where needed; analyzer score hidden in the reviewer-facing sheet;
> separate answer key with method, score, evidence, and family metadata. Use a 0–2
> rubric for core skills, experience/domain, seniority/years, and education/hard
> constraints. Include category mapping Weak 0–3, Medium 4–6, Strong 7–8. Do not
> tune model weights or change live scoring. Produce the files, methodology, and
> exact commands needed to regenerate them. Stop before committing.

**Prompt 3 — Final repository and production audit**

> Perform a final read-only release audit of Synthesis against the finish-line plan.
> Verify: final main commit and clean working tree; PRs merged and Preview/Production
> deployments; typecheck, all tests, and build; complete live journeys for Fit,
> Behavioural, and Case; truthful `embedding_backend`/`method`/fallback behaviour;
> voice manual fallback; responsive/accessibility basics; no auth/database/O*NET-RAG
> claims that contradict the code; no secrets, stale docs, dangling imports, or
> accidental artifacts; report/slides claims match the repository and validation
> evidence. Return a release table with PASS / FAIL / NOT VERIFIED, evidence,
> blockers, and the smallest fix. Do not modify files and do not merge anything.

**Prompt 4 — Final report claim audit**

> Review the final Synthesis report as a technical and academic fact-checker.
> Cross-check every implementation and metric claim against the current repository,
> deployment evidence, validation outputs, and source-of-truth document.
> Specifically flag: merged versus deployed versus production-hardened wording;
> structured, embedding, and hybrid metric datasets being mixed; claims that
> overstate role-fit or hiring suitability; O*NET RAG/database-provider language that no
> longer matches the architecture; voice capability being described as full
> conversation rather than speech-to-text input; incomplete human validation being
> described as complete; mock or fallback paths being presented as real model output.
> Produce a table of claim, evidence, verdict, and corrected wording. Do not rewrite
> the whole report until I approve the corrections.

---

## Appendix B. Final demo script and evidence capture plan

**Recommended 8-minute demo**

| Time | Action | Narrative |
|---|---|---|
| 0:00–0:45 | Landing page | Explain the interview-preparation problem and the three-module journey. |
| 0:45–3:00 | Fit Analyzer | Paste a rehearsed resume/JD pair, show the score, evidence, gaps, method/backend, and explain the hybrid approach. |
| 3:00–4:45 | Behavioural | Start a session, dictate one short answer, edit the transcript, and show scoring/manual fallback. |
| 4:45–6:30 | Case | Start a prepared case, show one exhibit/stage transition, and display the evaluation dimensions. |
| 6:30–7:20 | Validation | Show scoped offline results and the human-validation summary. |
| 7:20–8:00 | Architecture and close | Explain the O*NET RAG pivot, limitations, and next steps. |

**Evidence capture folder**

- `01_deployment` — final Vercel deployment and commit screenshots
- `02_fit` — input, hybrid result, fallback result, API response, logs
- `03_behavioural` — listening, transcript, score, denied/unsupported state
- `04_case` — active stage, exhibit, final score
- `05_validation` — sample sheet, summary table, chart, limitations
- `06_testing` — typecheck, test, build outputs
- `07_ux` — before/after desktop and mobile
- `08_presentation` — slides, demo script, backup recording

**Final message to yourself**

Finish by narrowing, not expanding. Synthesis already has the core product. Your
job now is to make it trustworthy, coherent, defensible, and easy to demonstrate. A
polished and validated MVP will score better than an unstable product with more
checkboxes.
