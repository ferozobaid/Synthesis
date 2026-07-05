# Deployment - Vercel

The default deployment path is mock mode: a demoable public deployment with no
API keys. Real Claude/Supabase credentials can be added later, but the Fit
Analyzer itself does not require Supabase.

## TL;DR

The app is deployment-safe as-is. Static content, cases, behavioural seed data,
and the O*NET taxonomy are bundled at build time. O*NET is loaded from
`lib/data/onet-taxonomy.json`; there is no O*NET RAG service, `onet_chunks`
table, or pgvector RPC to provision.

For a mock-mode Vercel deploy set:

```text
SYNTHESIS_USE_MOCKS=true
```

Then import the repo into Vercel. Next.js is auto-detected.

## Mock-Mode Deploy

Required environment variable:

| Var | Value | Purpose |
|---|---|---|
| `SYNTHESIS_USE_MOCKS` | `true` | Pins the app to mock mode and avoids Claude/Supabase calls. |

Do not set `ANTHROPIC_API_KEY` or Supabase variables for a public mock demo.

## Real-Mode Deploy

Use this only when you are ready for live Claude calls and user-data persistence.

| Var | Value | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic key | Enables real Claude calls. |
| `SYNTHESIS_USE_MOCKS` | `false` | Turns mocks off. |
| `SYNTHESIS_MODEL_MODE` | `default` | Uses the locked Haiku model. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL | User-data persistence/auth, if enabled. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Browser/client scoped Supabase access. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service key | Server-only Supabase access. |
| `EMBEDDINGS_ENABLED` | `false` on Vercel | Keep local semantic embeddings off on serverless unless explicitly tested. |

Mock mode is controlled by `useMocks()`:

```text
SYNTHESIS_USE_MOCKS=true   -> always mock
SYNTHESIS_USE_MOCKS=false  -> real mode
unset                      -> real only if Anthropic and Supabase creds are present
```

## Current Fit Analyzer Method

The Fit Analyzer API calls `scoreFitAnalyzer()`:

- Parses resume and JD text.
- Grounds skills against the local O*NET dictionary via `lib/onet.ts`.
- Uses `hybrid_0_25` when `EMBEDDINGS_ENABLED=true`: 25% rules + 75% local semantic matching.
- Falls back to rules-only if embeddings are disabled or fail to load.

This method does not query Supabase, pgvector, or an O*NET RAG index.

## Known Limitations

- **No authentication yet.** Sessions use mock data unless Supabase/user flows are wired.
- **Local embeddings on Vercel are not recommended by default.** `@xenova/transformers`
  is available in development, but serverless cold start and runtime constraints need
  separate testing before enabling `EMBEDDINGS_ENABLED=true` in production.
- **No O*NET RAG layer.** This is intentional. O*NET is a compact committed dictionary,
  and the current fit-scoring task benefits more from deterministic taxonomy grounding
  than from vector retrieval over O*NET text chunks.

## Pre-Deploy Verification

```bash
npm run typecheck
npm test
npm run validate:smoke
```

## Smoke Test

After deployment, open:

- `/`
- `/fit`
- `/behavioural`
- `/case`

And POST to `/api/fit/analyze` with a resume/JD pair. The JSON response includes
`scoring.method`, which should show `hybrid_0_25` only when local embeddings are
enabled; otherwise it will show `structured`.
