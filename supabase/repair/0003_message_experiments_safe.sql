-- Re-runnable form of supabase/migrations/0003_message_experiments.sql.
--
-- The original was never applied to production, so `alter table touches add column experiment_variant_id
-- ... references message_variants` failed with 42P01: relation "message_variants" does not exist — the
-- column references two tables that 0003 itself creates. Run this WHOLE file, top to bottom.
--
-- Safe to run more than once, and safe to run on a database where part of 0003 already landed: every
-- statement is guarded. It needs the base schema (cards, people, touches, app_owner, set_updated_at).
--
-- What it restores: logging a send to History (the "saving it to History failed" error), the Message Lab,
-- and the experiment figures on /stats.

-- 1. The status enum (CREATE TYPE has no IF NOT EXISTS).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'message_experiment_status') then
    create type message_experiment_status as enum ('draft','simulated','selected','sent','completed');
  end if;
end $$;

-- 2. The two tables the columns below point at.
create table if not exists message_experiments(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  card_id uuid not null references cards on delete cascade,
  person_id uuid not null references people on delete cascade,
  owner app_owner not null,
  channel text not null check(channel in ('comment','connection','email')),
  goal text not null,
  context text not null default '',
  focus_areas text[] not null default '{}',
  status message_experiment_status not null default 'draft',
  predicted_winner text check(predicted_winner in ('A','B')),
  selected_label text check(selected_label in ('A','B')),
  confidence int check(confidence between 0 and 100),
  model text not null
);

create table if not exists message_variants(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  experiment_id uuid not null references message_experiments on delete cascade,
  label text not null check(label in ('A','B')),
  subject text not null default '',
  body text not null,
  simulation_score int check(simulation_score between 0 and 100),
  dimensions jsonb not null default '{}',
  panel jsonb not null default '[]',
  selected boolean not null default false,
  unique(experiment_id,label)
);

-- 3. The two columns. touches.experiment_variant_id is the one that broke History logging on every send.
alter table cards   add column if not exists active_variant_id     uuid references message_variants on delete set null;
alter table touches add column if not exists experiment_variant_id uuid references message_variants on delete set null;

-- 4. Trigger, row-level security and indexes.
drop trigger if exists message_experiments_updated on message_experiments;
create trigger message_experiments_updated before update on message_experiments for each row execute function set_updated_at();

alter table message_experiments enable row level security;
alter table message_variants    enable row level security;

drop policy if exists authenticated_all on message_experiments;
create policy authenticated_all on message_experiments for all to authenticated using (true) with check (true);
drop policy if exists authenticated_all on message_variants;
create policy authenticated_all on message_variants for all to authenticated using (true) with check (true);

create index if not exists message_experiments_card       on message_experiments(card_id, created_at desc);
create index if not exists message_variants_experiment    on message_variants(experiment_id);

-- 5. Confirm it landed. Both rows should read 'ok'.
select 'touches.experiment_variant_id' as check_name, case when exists (
  select 1 from information_schema.columns where table_schema='public' and table_name='touches' and column_name='experiment_variant_id'
) then 'ok' else 'MISSING' end as state
union all
select 'cards.active_variant_id', case when exists (
  select 1 from information_schema.columns where table_schema='public' and table_name='cards' and column_name='active_variant_id'
) then 'ok' else 'MISSING' end;
