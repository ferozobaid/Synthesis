-- 0007_behavioural_sessions — a behavioural practice session. jd_id optional (for "why this company").
-- jd_id set null on JD delete so the session record survives.

create table if not exists public.behavioural_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  jd_id           uuid references public.job_descriptions (id) on delete set null,
  questions_asked jsonb,   -- [{ question_id, question }]
  scores          jsonb,   -- per-question dimension scores
  feedback        jsonb,   -- per-question + session summary
  created_at      timestamptz not null default now()
);

alter table public.behavioural_sessions enable row level security;

create policy "behavioural_sessions_select_own" on public.behavioural_sessions
  for select using (auth.uid() = user_id);
create policy "behavioural_sessions_insert_own" on public.behavioural_sessions
  for insert with check (auth.uid() = user_id);
create policy "behavioural_sessions_update_own" on public.behavioural_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "behavioural_sessions_delete_own" on public.behavioural_sessions
  for delete using (auth.uid() = user_id);
