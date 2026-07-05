# scripts/ — OFFLINE plane (owner: Rui)

Never imported by `/app` or `/lib` (a test enforces this). Runs independently or
orchestrated by n8n.

- `ingestion/` — extract → clean → chunk → embed → upsert (Python, local BGE-small).
- `validation/` — `profile_datasets.py`, `validate_matching.py`.

**Rules:** `ANTHROPIC_API_KEY` is never set in any script; embeddings are local
sentence-transformers (never a paid API); datasets are dev/validation only.
