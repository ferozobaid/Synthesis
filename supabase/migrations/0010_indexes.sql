-- 0010_indexes — HNSW vector indexes (cosine) + btree helpers for FK lookups.
-- HNSW skips NULL embeddings, so rows pending ingestion are fine.

create index if not exists resumes_embedding_hnsw
  on public.resumes using hnsw (embedding vector_cosine_ops);
create index if not exists jds_embedding_hnsw
  on public.job_descriptions using hnsw (embedding vector_cosine_ops);
create index if not exists answer_bank_embedding_hnsw
  on public.answer_bank using hnsw (embedding vector_cosine_ops);

-- FK / ownership lookups
create index if not exists resumes_user_idx              on public.resumes (user_id);
create index if not exists jds_user_idx                  on public.job_descriptions (user_id);
create index if not exists fit_results_user_idx          on public.fit_results (user_id);
create index if not exists fit_results_resume_idx        on public.fit_results (resume_id);
create index if not exists fit_results_jd_idx            on public.fit_results (jd_id);
create index if not exists answer_bank_user_idx          on public.answer_bank (user_id);
create index if not exists behavioural_sessions_user_idx on public.behavioural_sessions (user_id);
create index if not exists case_sessions_user_idx        on public.case_sessions (user_id);
create index if not exists case_sessions_case_idx        on public.case_sessions (case_id);
