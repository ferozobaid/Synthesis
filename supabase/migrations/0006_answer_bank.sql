-- 0006_answer_bank — per-user prepared STAR answers (RAG source for behavioural scoring).

create table if not exists public.answer_bank (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  question   text,
  situation  text,
  task       text,
  action     text,
  result     text,
  tags       text[],
  embedding  vector(384),  -- BGE-small-en-v1.5 (embed question + STAR for retrieval)
  created_at timestamptz not null default now()
);

alter table public.answer_bank enable row level security;

create policy "answer_bank_select_own" on public.answer_bank
  for select using (auth.uid() = user_id);
create policy "answer_bank_insert_own" on public.answer_bank
  for insert with check (auth.uid() = user_id);
create policy "answer_bank_update_own" on public.answer_bank
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "answer_bank_delete_own" on public.answer_bank
  for delete using (auth.uid() = user_id);
