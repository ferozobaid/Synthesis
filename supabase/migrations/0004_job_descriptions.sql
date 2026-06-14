-- 0004_job_descriptions — per-user JDs. RLS + cascade on user deletion.
-- company / role_title are convenience columns (also present inside parsed_requirements);
-- company feeds the behavioural "why this company" question.

create table if not exists public.job_descriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  company             text,
  role_title          text,
  parsed_requirements jsonb,        -- must_have[], nice_to_have[], seniority, years, domain, education
  raw_text            text,
  embedding           vector(384),  -- BGE-small-en-v1.5
  created_at          timestamptz not null default now()
);

alter table public.job_descriptions enable row level security;

create policy "jds_select_own" on public.job_descriptions
  for select using (auth.uid() = user_id);
create policy "jds_insert_own" on public.job_descriptions
  for insert with check (auth.uid() = user_id);
create policy "jds_update_own" on public.job_descriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jds_delete_own" on public.job_descriptions
  for delete using (auth.uid() = user_id);
