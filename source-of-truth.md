# Synthesis - Project Context

This is the current product-level source of truth. If older planning notes
conflict with this file, this file wins unless Feroz explicitly changes it.

> **Reconciliation note (14 July 2026, Codex handoff).** This file predates the v3
> cockpit UX and has not yet been fully rewritten. Until Phase F updates it:
> - For **current execution state and UX**, the authority is the
>   "Current Status at Codex Handoff" section of
>   `Synthesis_Finish_Line_Execution_Plan.md`. The v3 UX (landing, onboarding,
>   dashboard, unified readiness, dark/light theme, localStorage presentation
>   state, refreshed Fit/Behavioural/Case) is **complete, merged in PR #11, and
>   deployed** — it is not "future" work.
> - **Centralized persistence, authentication, and user accounts are descoped**
>   for the MVP. The future database provider is undecided, and no
>   provider-specific migrations should be designed yet.
> - The human-validation study target is **24–36 pairs** (per Phase C), which
>   supersedes the "40–60" figure further down in this file.

---

## What Synthesis Is

Synthesis is a voice-enabled, retrieval-assisted interview-preparation platform
for a Community Analytics capstone. It has three modules:

1. **Resume-to-JD Fit Analyzer** - scores one resume against one JD and returns
   an interpretable report with matched, partial, and missing requirements.
2. **Behavioural Interview Simulator** - asks JD-grounded behavioural questions
   and scores answers against the candidate's prepared STAR answer bank.
3. **Case Interview Simulator** - runs an adaptive consulting-case FSM with
   probes, redirects, exhibit reveals, hints, and final scoring.

---

## Current Fit Analyzer Decision

The Fit Analyzer does **not** use O*NET RAG or a remote vector database.

O*NET is used as a committed local data dictionary:

- `lib/data/onet-taxonomy.json`
- `lib/onet.ts`

The production Fit Analyzer route calls `scoreFitAnalyzer()`:

- rules-only structured scoring remains the baseline in `lib/matching.ts`;
- semantic requirement matching uses local BGE-small embeddings;
- production method is `hybrid_0_25` when embeddings are enabled;
- fallback is rules-only if embeddings are disabled or fail.

This keeps the live fit path simple, explainable, cheap, and independent of a
centralized database.

---

## Architecture

**Live plane:**

- Next.js app and API routes.
- Direct Claude calls for behavioural/case scoring where needed.
- Local O*NET dictionary grounding for fit analysis.
- Local retrieval helpers for behavioural answer-bank matching and case-stage
  context pre-fetch.

**Offline plane:**

- Validation scripts.
- Dataset preparation scripts.
- O*NET taxonomy maintenance scripts.

Offline scripts are never imported by the live app.

---

## Tech Stack And Budget

| Layer | Choice | Cost |
|---|---|---|
| Frontend / hosting | Next.js on Vercel | free tier |
| Auth / persistence | Not in the current MVP; future provider undecided | - |
| Fit taxonomy | Local O*NET JSON dictionary | free |
| LLM default | Claude Haiku 4.5 | cents |
| LLM demo only | Claude Sonnet 4.6 | about $1-2 |
| Embeddings | Local BGE-small via `@xenova/transformers` | free |
| Voice | Browser Web Speech API | free |

Guardrails: default to Haiku, keep embeddings local, and sample batch validation
work.

---

## Locked Decisions

- **Name:** Synthesis.
- **Fit analyzer scope:** one resume + one JD -> fit report.
- **O*NET:** local JSON dictionary only; no O*NET RAG or vector database.
- **Centralized database:** future provider undecided; do not create
  provider-specific clients, schemas, or migrations yet.
- **Hybrid fit method:** `hybrid_0_25` is the current production candidate,
  pending pair-level human validation.
- **Grading-model / LLM fine-tune study:** dropped.
- **Voice:** browser Web Speech API, added late after text paths work.
- **Datasets:** development and validation only; never live-product inputs.

---

## Datasets

| Dataset | Role |
|---|---|
| Resume Dataset (Kaggle, snehaanbhawal) | Resume side and family labels for validation |
| LinkedIn Job Postings 2023-24 (Kaggle, arshkon) | JD side, parser testing, validation |
| O*NET (US DOL) | Runtime taxonomy dictionary via curated JSON |

Resume and LinkedIn data are dev/validation only. O*NET feeds the live product
through the committed dictionary.

---

## Validation Position

The current automated validation is a scoped real-JD family-level proxy. It
tests whether a resume scores highest against JDs from its own broad family. It
is useful as a large-scale sanity check, but it is not direct pairwise fit
accuracy.

The next stronger validation is a human-labelled pair-level check: label 40-60
JD-resume pairs as strong, medium, or weak fit using a rubric, then test whether
rules-only, embedding-only, and hybrid_0_25 scores rank those pairs in the same
order.

---

## Team Roles

| Member | Owns |
|---|---|
| Feroz | architecture, case/retrieval helpers, repo review |
| Rui | validation, dataset preparation, embeddings, O*NET taxonomy maintenance |
| Emmanuel | fit analyzer module, frontend, voice wiring |
| Ibuken | content, behavioural/case materials, testing, write-up |

---

## Working Style

Be direct and honest. Flag scope creep and risk plainly. Keep planning docs
separate from repo build instructions in `CLAUDE.md`.
