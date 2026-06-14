-- 0009_case_sessions — a per-user case attempt driven by the FSM.
-- Cascades on user deletion; case_id cascades if the shared case is removed.

create table if not exists public.case_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  case_id    text not null references public.cases (id) on delete cascade,
  fsm_state  text not null default 'intro',  -- intro|clarification|framework|analysis|data_reveal|pressure_test|recommendation|scoring
  history    jsonb,   -- transcript: turns, stage_attempts, hints_used, exhibits_revealed
  score      jsonb,   -- dimension scores (structure/hypothesis/quant/synthesis/communication)
  feedback   jsonb,
  created_at timestamptz not null default now()
);

alter table public.case_sessions enable row level security;

create policy "case_sessions_select_own" on public.case_sessions
  for select using (auth.uid() = user_id);
create policy "case_sessions_insert_own" on public.case_sessions
  for insert with check (auth.uid() = user_id);
create policy "case_sessions_update_own" on public.case_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "case_sessions_delete_own" on public.case_sessions
  for delete using (auth.uid() = user_id);
