-- 0008_cases — shared, read-only case content (NOT per-user). Seeded from /context/cases/*.json.
-- id is a human slug (e.g. 'beautify', 'diconsa'). RLS allows read-all; writes via service role only.

-- Columns are exactly CLAUDE.md's locked set (id, title, firm, type, content, exhibits,
-- scoring_rubric) plus one additive column the live FSM requires: `stages`.
create table if not exists public.cases (
  id             text primary key,
  title          text not null,
  firm           text,
  type           text,
  content        text,          -- situation / prompt prose the candidate hears
  stages         jsonb,         -- FSM stages: objective, advance_criteria, probe_bank[], hint_ladder[3], data_drops[]
  exhibits       jsonb,         -- exhibit data (some synthesized — flagged per exhibit)
  scoring_rubric jsonb,
  created_at     timestamptz not null default now()
);

alter table public.cases enable row level security;

-- Cases are shared content: any authenticated session can read them.
create policy "cases_read_all" on public.cases
  for select using (true);
