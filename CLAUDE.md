# CLAUDE.md — Synthesis Build Instructions

This file instructs Claude Code during the build. It is distinct from the
project planning docs in the Claude Project. Do not conflate them.
When in doubt, source-of-truth.md wins on product decisions.
This file wins on build mechanics.

---

## What You Are Building

Synthesis: a voice-enabled, retrieval-grounded interview-preparation platform.
Three modules on a shared JD parser and RAG layer:

1. **Resume-to-JD Fit Analyzer** — parse resume + JD, score fit, return breakdown
2. **Behavioural Interview Simulator** — question generation from JD, score via RAG
3. **Case Interview Simulator** — adaptive FSM agent, probe/redirect/hint/score

---

## Two Planes — Never Cross Them

**LIVE PLANE** (every file in /app and /lib):
- Next.js API routes → direct Claude API streaming
- Supabase pgvector for retrieval
- Pre-fetch RAG at case load and stage transitions only
- Never block the request loop with batch work
- Never import anything from /scripts/ or /n8n/

**OFFLINE PLANE** (everything in /scripts/ and /n8n/):
- Ingestion pipeline: extract → clean → chunk → embed → upsert
- Orchestrated by n8n
- Runs independently, never called by the Next.js app
- Never imported by any live-plane file

If you find yourself importing a script from /scripts/ into /app/ or /lib/,
stop and restructure. That is always wrong.

---

## Non-Negotiable Rules

- **Default model:** `claude-haiku-4-5` — single config switch in /lib/claude.ts
- **Demo model:** `claude-sonnet-4-6` — only when explicitly toggled
- **Embeddings:** local sentence-transformers (BGE/MiniLM) — never a paid API
- **Voice:** Web Speech API, browser only — add AFTER text path works fully
- **n8n:** offline ingestion orchestration only — never on live request path
- **Credentials:** never hardcode, never set ANTHROPIC_API_KEY in scripts
- **Schemas first:** all Supabase migrations must exist before module code
- **RLS:** every per-user table must have Row Level Security enabled
- **User deletion:** cascade deletes required on all per-user data
- **Fine-tuning:** DROPPED — do not build, do not reference
- **Datasets:** dev/validation only — never imported by live-plane code

---

## Repo Structure

```
/
├── app/                        # Next.js App Router — live plane only
│   ├── api/
│   │   ├── fit/analyze/        # POST — fit analyzer
│   │   ├── behavioural/        # POST — session + answer
│   │   └── case/               # POST — session + respond
│   ├── fit/                    # Fit analyzer UI
│   ├── behavioural/            # Behavioural simulator UI
│   └── case/                   # Case simulator UI
├── lib/                        # Shared utilities — live plane only
│   ├── claude.ts               # Claude streaming client, model config
│   ├── supabase.ts             # Supabase client + Auth helpers
│   ├── embeddings.ts           # Local BGE/MiniLM embedding client
│   ├── rag.ts                  # pgvector retrieval interface
│   ├── parsers/
│   │   ├── jd-parser.ts        # Shared JD parser
│   │   └── resume-parser.ts    # Resume parser
│   └── fsm/
│       └── case-fsm.ts         # Case interview FSM
├── components/                 # Shared UI components
├── supabase/
│   └── migrations/             # All schema files — locked first
├── scripts/                    # Offline plane only — never imported by app
│   ├── ingestion/
│   │   ├── extract.py
│   │   ├── clean.py
│   │   ├── chunk.py
│   │   ├── embed.py
│   │   └── upsert.py
│   └── validation/
│       ├── profile_datasets.py
│       └── validate_matching.py
├── n8n/
│   └── workflow.json           # n8n ingestion orchestration
├── tests/                      # Unit + integration tests
├── context/                    # Context folder for Claude Code sessions
│   ├── source-of-truth.md
│   ├── cases/
│   ├── behavioural/
│   ├── jd_samples/
│   └── resume_samples/
├── CLAUDE.md                   # This file
├── README.md
└── .env.local.template
```

---

## Schema Tables (lock these before writing any module code)

- `users` — via Supabase Auth
- `resumes` — user_id FK, parsed_content JSONB, raw_file_url, embedding vector
- `job_descriptions` — user_id FK, parsed_requirements JSONB, raw_text, embedding vector
- `fit_results` — resume_id FK, jd_id FK, score INT, breakdown JSONB, gaps JSONB, keywords JSONB, recommendations JSONB
- `answer_bank` — user_id FK, question TEXT, situation TEXT, task TEXT, action TEXT, result TEXT, tags TEXT[], embedding vector
- `behavioural_sessions` — user_id FK, jd_id FK, questions_asked JSONB, scores JSONB, feedback JSONB
- `case_sessions` — user_id FK, case_id FK, fsm_state TEXT, history JSONB, score JSONB, feedback JSONB
- `cases` — id, title, firm, type, content TEXT, exhibits JSONB, scoring_rubric JSONB

RLS enabled on all per-user tables. Cascade delete on all user_id FKs.

---

## Case FSM States

```
intro → clarification → framework → analysis →
data_reveal → pressure_test → recommendation → scoring
```

Transition rules:
- Advance on strong response
- Probe/redirect on weak response (max 2 times per state)
- Graduated hint after 2 failed attempts at same state
- Drip one exhibit per data_reveal entry
- Never skip scoring state

---

## Team Ownership

| Member | Owns in this repo |
|---|---|
| Feroz | /lib/rag.ts, /lib/fsm/, /app/api/case/, schemas, PR review |
| Rui | /scripts/, /n8n/, /supabase/migrations/, /lib/embeddings.ts |
| Emmanuel | /app/fit/, /app/behavioural/, /components/, voice wiring |
| Ibuken | /context/behavioural/, /context/cases/, test content |

---

## Local Dev Setup

1. Copy `.env.local.template` → `.env.local`, fill in your Supabase + Anthropic keys
2. `npm install`
3. `npm run dev` — runs against mocks if no real credentials set
4. `npm test` — must pass with no credentials

Mocks live in `/lib/__mocks__/`. They intercept Supabase and Claude calls
in test/dev environments so the app runs without real API keys.

---

## Definition of Done (verify before any PR)

- [ ] `npm install && npm run dev` works with no real credentials
- [ ] All three module UIs are reachable and functional with mocked data
- [ ] `npm test` passes
- [ ] Supabase migrations apply cleanly (`supabase db push`)
- [ ] RLS + cascade delete on all per-user tables
- [ ] Validation script runs on fixtures and emits confusion matrix
- [ ] No /scripts/ imports in /app/ or /lib/
- [ ] No hardcoded credentials anywhere
- [ ] ANTHROPIC_API_KEY never set in any script

---

## Build Status — Foundation (checkpoint 1)

Built this pass (Steps 0–4); paused here for review before module code.

**Done & verified (no real credentials):**
- `npm install && npm run build` ✓ · `npm test` ✓ (19 tests) · `tsc --noEmit` ✓
- Next.js 14 + TS + Tailwind scaffold; home + `/fit`, `/behavioural`, `/case` UIs reachable on mock data
- API routes `POST /api/fit/analyze`, `/api/behavioural`, `/api/case` return mock-backed data; smoke-tested live
- Locked schema contract: `supabase/migrations/0001–0010` (pgvector, RLS + cascade on every per-user table, HNSW cosine indexes) + `/lib/types.ts`
- Shared `/lib`: `claude` (Haiku default / Sonnet demo, streaming), `supabase` (+auth), `embeddings` (BGE-small, mock fallback), `rag` (pre-fetch top-k), `parsers/{jd,resume}` (EDA cleaning), `fsm/case-fsm` (8 states, probe/redirect/hint/drip), all with `__mocks__/`
- Processed `/context`: 2 structured case JSONs, behavioural question + seed answer banks, scoring criteria, 3 resume + 3 JD samples
- `.env.local.template`, `.gitignore` (excludes `Datasets/`), lane READMEs

**Decisions applied:** local BGE-small both planes (`@xenova/transformers` live, optional/lazy + mock fallback; Python offline); CLAUDE.md FSM state names + folder layout; the older `claude_code_kickoff_prompt.md` is superseded.

**For review — one additive column:** `cases` carries a `stages jsonb` column beyond CLAUDE.md's locked list (id, title, firm, type, content, exhibits, scoring_rubric), because the live FSM needs structured stages. Everything else matches the locked set.

**Flagged:** case exhibits (Beautify competitor-chatbot metrics; Diconsa regional survey) are **synthesized** to fill image-only gaps in the source PDFs — marked `"synthesized": true` per exhibit; review against the official exhibits.

**Not yet built (post-checkpoint):** real fit scoring (embeddings + rules), behavioural/case scoring via Claude, voice, offline ingestion + n8n, validation harness. `supabase db push` not run (no CLI/project yet).

See the build plan: `~/.claude/plans/you-are-building-synthesis-async-dusk.md`.

---

## Build Status — Module 3: Behavioural Simulator (complete · 2026-06-15)

Modules 1 (fit) and 2 (case) are merged on `main`; Module 3 turns the Behavioural
Simulator from mocked Q&A into a real pipeline.

**Done & verified (no real credentials):** `npm run build` ✓ · `tsc --noEmit` ✓ ·
`npm test` ✓ (81 tests). Full mock session runs via `/api/behavioural` and `/behavioural`.

- **Question generation** (`lib/behavioural/question-gen.ts`): fills "why this company"
  (`{{company}}`) and "why this role" from the parsed JD; generic fallback when no JD.
- **Evaluator** (`lib/behavioural/evaluator.ts`): mirrors `case-evaluator` — deterministic
  STAR heuristic (mock) + Haiku-with-fallback (real), returning the shared `BehaviouralScore`.
- **Runner** (`lib/behavioural/runner.ts`): `startBehavioural` / `respondToBehavioural` /
  `summarizeBehavioural` (per-question feedback + aggregate session summary).
- **Wiring**: `/api/behavioural` (`start`/`respond`/`summary`) + `/behavioural` session-flow UI.
- **RAG**: extended `retrieveAnswer` with a mock-mode lexical blend (non-semantic mock
  embeddings), gated on `!embeddingsEnabled()` so the real-mode cosine path is unchanged;
  shared lexical helpers in `lib/text.ts`.

**Scoring rubric (decision):** used the existing **5-dimension** rubric already shipped in
`context/scoring_criteria.md` (STAR structure, Specificity, Ownership, Impact, Key-point
coverage; 1–5) rather than the 3-dimension variant in the Module 3 brief — it matches the
established types and the case module. Key-point coverage is the RAG-grounded dimension and
is marked "not applicable" (dropped, never scored 0) when no prepared answer is retrieved.

**No bootstrapping:** all three `/context/behavioural/` inputs were already real
(`question_bank.json`, `seed_answer_bank.json`, and the behavioural rubric inside the shared
`context/scoring_criteria.md`). No schema/migration changes; voice still deferred (text only).
