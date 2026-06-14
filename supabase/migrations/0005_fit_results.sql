-- 0005_fit_results — fit analyzer output. Cascades on user, resume, or JD deletion.
-- user_id is denormalized so RLS is a simple auth.uid() check.

create table if not exists public.fit_results (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  resume_id       uuid not null references public.resumes (id) on delete cascade,
  jd_id           uuid not null references public.job_descriptions (id) on delete cascade,
  score           int check (score between 0 and 100),
  breakdown       jsonb,   -- per_requirement[] { requirement, status, evidence, weight }
  gaps            jsonb,
  keywords        jsonb,   -- missing / matched keywords
  recommendations jsonb,
  created_at      timestamptz not null default now()
);

alter table public.fit_results enable row level security;

create policy "fit_results_select_own" on public.fit_results
  for select using (auth.uid() = user_id);
create policy "fit_results_insert_own" on public.fit_results
  for insert with check (auth.uid() = user_id);
create policy "fit_results_update_own" on public.fit_results
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fit_results_delete_own" on public.fit_results
  for delete using (auth.uid() = user_id);
