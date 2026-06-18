-- 0011_onet_chunks — shared O*NET retrieval corpus (NOT per-user). Populated offline
-- (scripts/onet + n8n). RLS read-all; writes via service role. Mirrors lib/types OnetChunk.
create table if not exists public.onet_chunks (
  id               uuid primary key default gen_random_uuid(),
  soc              text not null,                 -- occupation code, e.g. '15-2051.00'
  occupation_title text not null,
  content_type     text not null,                 -- 'skill'|'task'|'tool'|'knowledge'|'description'
  content          text not null,                 -- retrieval-sized chunk text
  metadata         jsonb not null default '{}',   -- {importance, source_file, ...}
  embedding        vector(384),                   -- BGE-small-en-v1.5 (CLS pooling + L2)
  created_at       timestamptz not null default now()
);

alter table public.onet_chunks enable row level security;

-- O*NET is shared reference content: any authenticated session can read it.
create policy "onet_chunks_read_all" on public.onet_chunks
  for select using (true);

create index if not exists onet_chunks_embedding_hnsw
  on public.onet_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists onet_chunks_content_type_idx on public.onet_chunks (content_type);
create index if not exists onet_chunks_soc_idx          on public.onet_chunks (soc);

-- pgvector RPC the live retriever calls in real mode (cosine; HNSW skips NULL embeddings).
create or replace function public.match_onet_chunks(
  query_embedding vector(384), match_count int default 5, filter_content_type text default null
) returns table (
  id uuid, soc text, occupation_title text, content_type text,
  content text, metadata jsonb, similarity float
) language sql stable as $$
  select c.id, c.soc, c.occupation_title, c.content_type, c.content, c.metadata,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.onet_chunks c
  where c.embedding is not null
    and (filter_content_type is null or c.content_type = filter_content_type)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
