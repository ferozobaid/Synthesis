# Real-Mode Verification Notes

This document records how "real mode" should be interpreted in the current repo.

## Current Architecture

- **Fit Analyzer:** no Claude call. It parses resume/JD text, grounds skills with
  the local O*NET dictionary, and calls `scoreFitAnalyzer()`.
- **Behavioural Simulator:** uses Claude for answer evaluation when real mode is
  enabled.
- **Case Simulator:** uses Claude for per-turn evaluation and final scoring when
  real mode is enabled.

## Fit Analyzer Method

The Fit Analyzer production route is:

```text
parseResume + parseJD
-> scoreFitAnalyzer()
-> hybrid_0_25 if EMBEDDINGS_ENABLED=true
-> structured rules-only fallback otherwise
```

O*NET is not retrieved from Supabase or pgvector. It is loaded from:

```text
lib/data/onet-taxonomy.json
lib/onet.ts
```

## Real Mode

`useMocks()` controls mock versus real service calls:

```text
SYNTHESIS_USE_MOCKS=true   -> always mock
SYNTHESIS_USE_MOCKS=false  -> real service path
unset                      -> real only if required credentials are present
```

Fit analysis remains local in both mock and real mode. The `mock` flag only tells
the UI whether external app credentials are configured; it does not change the
O*NET dictionary or the fit scoring code path.

## Verification Commands

```bash
npm run typecheck
npm test
npm run validate:smoke
```

For local semantic fit scoring:

```bash
EMBEDDINGS_ENABLED=true
EMBEDDINGS_MODEL=Xenova/bge-small-en-v1.5
```

The API response from `/api/fit/analyze` includes `scoring.method`, which should
be `hybrid_0_25` when embeddings are enabled and `structured` when the analyzer
falls back to rules-only.
