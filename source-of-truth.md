# Synthesis — Project Context (Source of Truth)

This is the canonical reference for what Synthesis is and what's been decided.
If anything in a chat or session conflicts with this doc, this doc wins —
unless Feroz explicitly changes a decision here.

---

## What Synthesis Is

A voice-enabled, retrieval-grounded interview-preparation platform, built as a
Community Analytics capstone (team of 4; Feroz is the lead). Three modules on a
shared JD parser and a retrieval (RAG) layer:

**Resume-to-JD Fit Analyzer** — the user uploads their resume and a job description
they choose; the app parses both, matches the resume against that JD's requirements,
and returns a fit score with a per-requirement breakdown, gaps, missing keywords,
and recommendations.

**Behavioural Interview Simulator** — asks behavioural questions (incl. "why this
company," pulled from the parsed JD) and scores the answer against the candidate's
own prepared answers, which are ingested into a per-user answer bank.

**Case Interview Simulator** — an adaptive agent runs a consulting case via a
finite-state machine, probing/redirecting/dripping data/giving graduated hints,
and scores performance.

---

## Architecture (Two Planes)

**Live plane (must be fast):**
Next.js app + API routes, direct streaming calls to the Claude API,
retrieval from Supabase pgvector.

**Offline plane:**
An ingestion pipeline (extract → clean → chunk → embed → upsert),
orchestrated by n8n. Nothing on the offline plane is ever on a live request path.

---

## Tech Stack & Budget (target under USD 10)

| Layer | Choice | Cost |
|---|---|---|
| Frontend / hosting | Next.js on Vercel | free tier |
| DB / vectors / auth / storage | Supabase (Postgres + pgvector) | free tier |
| LLM (default) | Claude Haiku 4.5 | cents |
| LLM (demo only) | Claude Sonnet 4.6 | ~$1–2 |
| Embeddings | local sentence-transformers (BGE/MiniLM) | free |
| Voice | browser Web Speech API | free |
| Orchestration | n8n (offline ingestion only) | free |

Guardrails: default to Haiku; matching runs on local embeddings; sample for batch
work; hard spend cap in the API console. The $10 is app API usage only —
Claude Code subscriptions are separate.

---

## Locked Decisions (do not reopen unless Feroz changes them here)

- **Name:** Synthesis.
- **Fit analyzer scope:** scores a resume against a JD the user uploads. Datasets
  are development/validation only — they never run in the live product.
- **Grading-model / LLM fine-tune study:** DROPPED. Not in scope.
- **Voice:** free browser Web Speech API; added late (after text works),
  behavioural module first; kill-switch = if voice is unstable, demo
  behavioural-in-voice + the rest in text.
- **Build tool:** the team standardises on Claude Code; schemas are locked first
  as the shared contract.

---

## Datasets

| Dataset | Role | Link |
|---|---|---|
| Resume Dataset (Kaggle, snehaanbhawal) — ~2,484 rows, labelled by category, CC0 | resume side + validation ground truth | kaggle.com/datasets/snehaanbhawal/resume-dataset |
| LinkedIn Job Postings 2023–24 (Kaggle, arshkon) — ~124k postings, scraped (cite-only) | JD side; parser testing + validation | kaggle.com/datasets/arshkon/linkedin-job-postings |
| O*NET (US DOL) — ~900+ occupations → skills/tasks, cleanly licensed | runtime requirements taxonomy | onetcenter.org/database.html |

Resume + LinkedIn = dev/validation only. O*NET feeds the live product.

---

## Validation Methodology

Because resumes are labelled by category, test a falsifiable claim — a resume scores
highest against postings from its own field — reporting top-1/top-3 accuracy, a
confusion matrix, and an embeddings-vs-structured ablation. This validates the
matching engine; it does not (and cannot) prove a single fit score is objectively
"correct," because no ground-truth fit score exists. That's a limitation of the
validation, not the product.

---

## Team & Roles

| Member | Owns | Backup |
|---|---|---|
| Feroz (Lead) | agents + retrieval core; repo, schemas, PR review | Data/RAG |
| Rui | data engineering: ingestion, Supabase/pgvector, embeddings, n8n, validation | fit analyzer (data) |
| Emmanuel | fit analyzer module + frontend & voice | content |
| Ibuken | content & comms: answer docs, question bank, datasets, slides, write-up | presentation/testing |

---

## Timeline

Build window June 12 – July 30 (~7 weeks).
Checkpoints: Progress Report 4 = June 26; Final Presentation = July 30.
Sequencing: every module works in text before voice.

---

## Open Items

- Fill real data numbers into the proposal from the profiling script.
- Team emails in the proposal; decide whether to strip the template's italic guidance.

---

## How to Work with Feroz

Be direct and honest — real assessments, not reassurance. Flag scope creep and risk
plainly. Be concise; prose over heavy formatting unless asked. When asked for a
document, produce the actual file. Keep this Claude Project (planning, docs, analysis,
the proposal) distinct from the GitHub repo's CLAUDE.md (which instructs Claude Code
during the build) — different layers, don't conflate them.
