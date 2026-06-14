-- 0003_resumes — per-user resumes. RLS + cascade on user deletion.

create table if not exists public.resumes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  parsed_content jsonb,            -- structured resume (sections, skills, experience)
  raw_file_url   text,            -- Supabase Storage path to the uploaded file
  embedding      vector(384),     -- BGE-small-en-v1.5
  created_at     timestamptz not null default now()
);

alter table public.resumes enable row level security;

create policy "resumes_select_own" on public.resumes
  for select using (auth.uid() = user_id);
create policy "resumes_insert_own" on public.resumes
  for insert with check (auth.uid() = user_id);
create policy "resumes_update_own" on public.resumes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "resumes_delete_own" on public.resumes
  for delete using (auth.uid() = user_id);
