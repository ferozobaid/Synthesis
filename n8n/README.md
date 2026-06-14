# n8n/ — OFFLINE ingestion orchestration only (owner: Rui)

`workflow.json` chains `scripts/ingestion` (extract → clean → chunk → embed → upsert).
Never on a live request path; never invoked by `/app` or `/lib`.
