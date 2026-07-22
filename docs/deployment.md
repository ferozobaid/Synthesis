# Deployment - Vercel

The default deployment path is mock mode: a demoable public deployment with no
API keys. A Claude credential enables live behavioural and case evaluation; the
app has no active centralized database dependency.

## TL;DR

The app is deployment-safe as-is. Static content, cases, behavioural seed data,
and the O*NET taxonomy are bundled at build time. O*NET is loaded from
`lib/data/onet-taxonomy.json`; there is no O*NET RAG service, `onet_chunks`
table, or remote vector search service to provision.

For a mock-mode Vercel deploy set:

```text
SYNTHESIS_USE_MOCKS=true
```

Then import the repo into Vercel. Next.js is auto-detected.

## Mock-Mode Deploy

Required environment variable:

| Var | Value | Purpose |
|---|---|---|
| `SYNTHESIS_USE_MOCKS` | `true` | Pins the app to mock mode and avoids Claude calls. |

Do not set `ANTHROPIC_API_KEY` for a public mock demo.

## Real-Mode Deploy

Use this only when you are ready for live Claude calls.

| Var | Value | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic key | Enables real Claude calls. |
| `SYNTHESIS_USE_MOCKS` | `false` | Turns mocks off. |
| `SYNTHESIS_MODEL_MODE` | `default` | Uses the locked Haiku model. |
| `EMBEDDINGS_ENABLED` | `true` | Enables the packaged BGE semantic scoring path. |
| `EMBEDDINGS_MODEL` | `Xenova/bge-small-en-v1.5` | Selects the supported 384-dimensional BGE model. |
| `EMBEDDINGS_MODEL_REVISION` | `ea104dacec62c0de699686887e3f920caeb4f3e3` | Pins the model files downloaded during the build. |
| `BGE_INFERENCE_CONCURRENCY` | `2` | Bounds concurrent ONNX inference work per function instance. |

Mock mode is controlled by `useMocks()`:

```text
SYNTHESIS_USE_MOCKS=true   -> always mock
SYNTHESIS_USE_MOCKS=false  -> real mode
unset                      -> real only if the Anthropic credential is present
```

## Current Fit Analyzer Method

The Fit Analyzer API calls `scoreFitAnalyzer()`:

- Parses resume and JD text.
- Grounds skills against the local O*NET dictionary via `lib/onet.ts`.
- Uses `hybrid_0_25` when `EMBEDDINGS_ENABLED=true`: 25% rules + 75% local semantic matching.
- Falls back to rules-only if embeddings are disabled or fail to load.

This method does not query a centralized database, vector store, or O*NET RAG index.

## Known Limitations

- **No authentication or database persistence.** Those flows are outside the
  current MVP. The future centralized database provider is undecided, so there
  is no provider-specific schema or migration setup.
- **The BGE model is packaged at build time.** `prebuild` downloads the pinned
  quantized model into the generated `models/` directory. The Fit Analyzer runs
  in the Node.js runtime and disables remote model loading when the packaged files
  are present.
- **The generated model directory is intentionally gitignored.** Do not commit the
  ONNX binary. Run `npm run build` to reproduce it from the pinned Hugging Face
  revision.
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

And POST to `/api/fit/analyze` with a resume/JD pair. A healthy BGE deployment
must return all of the following under `scoring`:

```json
{
  "method": "hybrid_0_25",
  "embedding_backend": "bge",
  "embedding_model": "Xenova/bge-small-en-v1.5",
  "embedding_failure_category": null,
  "fallback_reason": null
}
```

If `embedding_backend` is `failed`, inspect the structured Vercel log entry named
`[embeddings] BGE model load failed`. It includes the model, runtime, and original
error message while the user request safely falls back to structured scoring.
