# Synthesis

A voice-enabled, retrieval-grounded **interview-preparation platform**, built as a
Community Analytics capstone. Three modules on one shared JD-parser + RAG backbone:

1. **Resume-to-JD Fit Analyzer** — parse a resume + a chosen job description, match
   per-requirement, and return an interpretable fit score (matched / partial / missing,
   gaps, missing keywords, recommendations).
2. **Behavioural Interview Simulator** — behavioural questions (incl. "why this company"
   from the parsed JD), scored against the user's own STAR answer bank via RAG.
3. **Case Interview Simulator** — an adaptive FSM agent that probes, redirects, drips
   exhibit data, gives graduated hints, and scores.

> **Status:** foundation scaffold. The three module UIs run on **mocked data with no real
> credentials**. See [CLAUDE.md](CLAUDE.md) for build mechanics and locked decisions, and
> `source-of-truth.md` for product decisions.

---

## Quick start (no credentials needed)

```bash
npm install
npm run dev      # http://localhost:3000 — home + 3 modules on mock data
npm test         # unit + integration tests, all on mocks
```

To run against live services, copy `.env.local.template` → `.env.local` and fill in your
Supabase + Anthropic keys. Absent keys, the app automatically uses mocks (`/lib/__mocks__/`).

**Deploying?** See [docs/deployment.md](docs/deployment.md) — a public Vercel deploy in
mock mode needs only `SYNTHESIS_USE_MOCKS=true` (no API keys).

---

## Two planes — never cross them

- **LIVE plane** (`/app`, `/lib`): Next.js API routes → direct Claude API streaming;
  Supabase pgvector retrieval; pre-fetch RAG at case load + stage transitions only.
- **OFFLINE plane** (`/scripts`, `/n8n`): ingestion (extract → clean → chunk → embed →
  upsert) + validation, orchestrated by n8n. **Never imported by the live plane.**

A guard test asserts no `/scripts` import ever appears in `/app` or `/lib`.

---

## Locked decisions

| Area | Decision |
|---|---|
| Default model | `claude-haiku-4-5` (single switch in `/lib/claude.ts`) |
| Demo model | `claude-sonnet-4-6` (only when toggled) |
| Embeddings | local **BGE-small-en-v1.5** (384-dim) — `@xenova/transformers` live, Python `sentence-transformers` offline. Never a paid API. |
| Voice | Web Speech API, browser only, added after text works (behavioural first) |
| Auth | Supabase Auth + RLS + cascade delete on every per-user table |
| Datasets | dev/validation only — never on the live path |

### Embeddings note

`@xenova/transformers` is an **optional, lazily-loaded** dependency so `npm install`/`npm test`
stay fast and native-build-free. `/lib/embeddings.ts` uses a deterministic local fallback by
default; set `EMBEDDINGS_ENABLED=true` and `npm install @xenova/transformers` to switch on real
BGE-small vectors. Offline ingestion uses the same model family (`BAAI/bge-small-en-v1.5`) so
vectors are comparable — a parity test asserts cosine(same text) > 0.99.

---

## Repo structure

```
app/         Next.js App Router — live plane (UIs + API routes)
lib/         Shared live-plane utilities (claude, supabase, embeddings, rag, parsers, fsm, types)
components/   Shared UI
supabase/    Migrations (the locked schema contract)
scripts/     Offline plane: ingestion/ + validation/ (Python) — never imported by app
n8n/         Offline ingestion orchestration
context/     Processed content (cases, behavioural bank, samples, scoring criteria)
tests/       Vitest unit + integration
```

See [CLAUDE.md](CLAUDE.md) for team ownership and the Definition of Done.
