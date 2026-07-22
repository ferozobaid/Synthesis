# CLAUDE.md - Synthesis Build Instructions

This file captures the current build mechanics for this repo. For product-level
decisions, `source-of-truth.md` is the companion planning document.

---

## What You Are Building

Synthesis is an interview-preparation platform with three modules:

1. **Resume-to-JD Fit Analyzer** - parses a resume and JD, grounds requirements
   against the committed O*NET JSON dictionary, and returns an interpretable fit
   report.
2. **Behavioural Interview Simulator** - asks JD-grounded behavioural questions
   and scores answers against the user's prepared STAR answer bank.
3. **Case Interview Simulator** - runs an adaptive FSM interviewer that probes,
   redirects, reveals exhibits, gives hints, and scores the session.

The current production Fit Analyzer method is `hybrid_0_25`: 25% deterministic
rules + 75% local semantic requirement matching when `EMBEDDINGS_ENABLED=true`,
with a rules-only fallback.

---

## Architecture Decisions

- **O*NET grounding:** local JSON dictionary only:
  `lib/data/onet-taxonomy.json` loaded through `lib/onet.ts`.
- **No O*NET RAG:** do not build `onet_chunks`, `match_onet_chunks`, vector
  database ingestion, or remote database storage for O*NET taxonomy content.
- **Embeddings:** local BGE-small via `@xenova/transformers`; never a paid API.
- **Centralized database:** authentication and persistence are not part of the
  current MVP. The future provider is undecided; do not add a provider-specific
  client, configuration, schema, or migrations until that decision is made.
- **Retrieval helpers:** `lib/rag.ts` is only for behavioural answer-bank matching
  and case-stage pre-fetch. It is not an O*NET retriever.
- **Datasets:** dev/validation only; never imported by live-plane code.

---

## Two Planes

**Live plane** (`/app`, `/lib`):

- Next.js API routes and UI.
- Direct Claude calls where needed.
- Local O*NET dictionary grounding for fit analysis.
- Local semantic embeddings for Fit Analyzer hybrid scoring.
- Local retrieval helpers for behavioural/case context.
- Never import anything from `/scripts`.

**Offline plane** (`/scripts`):

- Validation harnesses.
- O*NET taxonomy maintenance scripts.
- Dataset preparation scripts.
- Never imported by any live-plane file.

If you find yourself importing a script from `/scripts` into `/app` or `/lib`,
stop and restructure.

---

## Repo Structure

```text
app/          Next.js App Router: UIs + API routes
lib/          Live utilities: parsers, scoring, O*NET dictionary, embeddings,
              retrieval helpers, case FSM, shared types
components/   Shared UI
scripts/      Offline validation + O*NET taxonomy maintenance
context/      Cases, behavioural bank, JD/resume samples, scoring criteria
tests/        Vitest unit + integration tests
reports/      Generated deliverable reports
```

---

## Non-Negotiable Rules

- Default Claude model: `claude-haiku-4-5`.
- Demo Claude model: `claude-sonnet-4-6`, only when explicitly toggled.
- Do not hardcode credentials.
- Do not set `ANTHROPIC_API_KEY` in scripts.
- Do not import datasets or validation artifacts into live-plane code.
- Do not add authentication, persistence, or provider-specific database code.
- Do not reintroduce O*NET vector-database RAG; use `lib/onet.ts`.
- Keep `scoreFit()` available as the structured baseline.
- Use `scoreFitAnalyzer()` for the production Fit Analyzer path.
- Run `npm run typecheck` and `npm test` after relevant code changes.

---

## Fit Analyzer

Key files:

- `lib/data/onet-taxonomy.json` - committed O*NET dictionary subset.
- `lib/onet.ts` - skill normalization, canonical extraction, related skills,
  occupation matching.
- `lib/parsers/resume-parser.ts` - resume parser.
- `lib/parsers/jd-parser.ts` - JD parser.
- `lib/matching.ts` - deterministic rules-only baseline.
- `lib/matching-semantic.ts` - semantic scoring and `hybrid_0_25` production
  analyzer helper.
- `app/api/fit/analyze/route.ts` - Fit Analyzer API route.

Validation artifacts under `scripts/validation/.artifacts/` are generated and
gitignored. The current validation report is generated from
`metrics.scoped.json`.

---

## Behavioural And Case Retrieval

`lib/rag.ts` remains useful, but it is not O*NET RAG:

- `retrieveAnswer()` retrieves the closest prepared STAR answer for behavioural
  scoring.
- `prefetchCaseStage()` prepares case-stage context and exhibit insights at case
  load or stage transitions.

---

## Definition Of Done

- `npm run typecheck` passes.
- `npm test` passes.
- No `/scripts` imports appear in `/app` or `/lib`.
- Fit Analyzer continues to run without a centralized database.
- O*NET taxonomy access remains local JSON + `lib/onet.ts`.
- Any validation claim is backed by current `scripts/validation` artifacts or a
  clearly described human-check plan.
