# Synthesis

A voice-enabled, retrieval-assisted interview-preparation platform, built as a
Community Analytics capstone. The app has three modules:

1. **Resume-to-JD Fit Analyzer** - parses a resume and a job description, grounds
   skills against `lib/data/onet-taxonomy.json`, and returns an interpretable fit
   report. The current production method is `hybrid_0_25`: 25% deterministic
   rules + 75% local semantic matching when embeddings are enabled, with a
   rules-only fallback.
2. **Behavioural Interview Simulator** - asks JD-grounded behavioural questions
   and scores answers against the user's prepared STAR answer bank.
3. **Case Interview Simulator** - runs an adaptive FSM interviewer that probes,
   redirects, reveals exhibits, gives hints, and scores the final response.

The Fit Analyzer does **not** use O*NET RAG or a remote vector database. O*NET
is a committed local data dictionary loaded through `lib/onet.ts`.

---

## Quick Start

```bash
npm install
npm run dev      # http://localhost:3000
npm test
```

To run against live services, copy `.env.local.template` to `.env.local` and fill
in the relevant keys. Absent keys, the app falls back to mock mode.

For semantic fit scoring, set:

```bash
EMBEDDINGS_ENABLED=true
EMBEDDINGS_MODEL=Xenova/bge-small-en-v1.5
```

---

## Two Planes

- **Live plane** (`/app`, `/lib`): Next.js API routes, direct Claude calls where
  needed, local O*NET dictionary grounding for fit analysis, and local retrieval
  helpers for behavioural answer-bank matching / case-stage pre-fetch.
- **Offline plane** (`/scripts`): validation scripts and O*NET taxonomy
  maintenance. Offline scripts are never imported by the live plane.

A guard test asserts no `/scripts` import appears in `/app` or `/lib`.

---

## Locked Decisions

| Area | Decision |
|---|---|
| Default model | `claude-haiku-4-5` |
| Demo model | `claude-sonnet-4-6` |
| Fit Analyzer | `hybrid_0_25` when local embeddings are enabled; rules-only fallback |
| O*NET | Local JSON dictionary only: `lib/data/onet-taxonomy.json` |
| Embeddings | Local BGE-small via `@xenova/transformers`; never a paid API |
| Voice | Web Speech API, browser only |
| Auth / persistence | Not in the current MVP; future centralized database provider undecided |
| Datasets | Dev/validation only; never imported by live-plane code |

---

## Repo Structure

```text
app/          Next.js App Router - UIs + API routes
lib/          Live-plane utilities: parsers, fit scoring, O*NET dictionary,
              embeddings, retrieval helpers, case FSM, shared types
components/   Shared UI
scripts/      Offline validation and O*NET taxonomy maintenance
context/      Cases, behavioural bank, samples, scoring criteria
tests/        Vitest unit + integration tests
reports/      Generated project reports
```

See `CLAUDE.md` for build mechanics and `source-of-truth.md` for product framing.
