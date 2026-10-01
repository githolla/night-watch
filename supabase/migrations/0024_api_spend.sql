-- One place every Anthropic call is costed, so "what did today cost?" is answerable inside the app.
--
-- Today it is not. Spend is split across runs.cost_usd, run_accounts.cost_usd and
-- accounts.analysis_cost_usd, and three routes that call the model — regenerating drafts, Refine on a
-- single draft, and the Message Lab — record nothing at all. On 2026-09-21 the console billed $78 while
-- the database could account for $18.65; the missing $59 had nowhere to be written down.
--
-- Safe to run more than once. Nothing else needs changing: the app writes here when the table exists and
-- carries on silently when it does not, so applying this is what turns the Spend panel on.

create table if not exists api_spend(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- What caused the call: 'rewrite_drafts' | 'refine_draft' | 'message_lab' | 'research' | 'analysis' | ...
  source text not null,
  model text,
  cost_usd numeric not null default 0,
  -- Whatever helps trace one line back to a prospect or a run.
  detail jsonb not null default '{}'
);

create index if not exists api_spend_created on api_spend(created_at desc);
create index if not exists api_spend_source on api_spend(source, created_at desc);

alter table api_spend enable row level security;
drop policy if exists authenticated_all on api_spend;
create policy authenticated_all on api_spend for all to authenticated using (true) with check (true);

-- Confirm it landed.
select 'api_spend' as check_name, case when exists (
  select 1 from information_schema.tables where table_schema='public' and table_name='api_spend'
) then 'ok' else 'MISSING' end as state;
