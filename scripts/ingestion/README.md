# scripts/ingestion/ — build in Step 8 (owner: Rui)

Offline pipeline: `extract.py → clean.py → chunk.py → embed.py → upsert.py`.

- Apply the EDA cleaning rules: drop Agriculture/Automobile/BPO + the 3 corrupt
  resume rows, Unicode-normalize the full-width dash (U+FF0D), strip the ALL-CAPS
  title line; on LinkedIn, de-dupe the 15.3% reposts and read timestamps as epoch **ms**.
- `embed.py` uses `sentence-transformers` `BAAI/bge-small-en-v1.5` (384-dim, **CLS
  pooling + L2 normalize**) to match the live plane's `@xenova/transformers` vectors.
- `upsert.py` writes embeddings into Supabase pgvector (HNSW cosine).
