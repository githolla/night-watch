-- One row per company per run. Live progress, the error log, coverage
-- numbers and run history all read from this table instead of from four
-- disagreeing sources.
create type run_status as enum ('open','complete','cancelled');
create type run_account_status as enum ('queued','running','ok','no_signal','error','cancelled');

alter table runs
  add column status run_status not null default 'open',
  add column source text not null default 'scheduled' check (source in ('scheduled','manual')),
  add column requested_accounts int not null default 0,
  add column heartbeat_at timestamptz,
  add column cancel_requested boolean not null default false,
  add column invocations int not null default 0;

-- Runs recorded before this migration all finished one way or another.
update runs set status = 'complete' where finished_at is not null;

create table run_accounts(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  run_id uuid not null references runs on delete cascade,
  account_id uuid not null references accounts on delete cascade,
  position int not null,
  domain text not null,
  name text not null,
  status run_account_status not null default 'queued',
  error_code text,
  error_message text,
  signals_found int not null default 0,
  signals_kept int not null default 0,
  signals_new int not null default 0,
  cards_created int not null default 0,
  cost_usd numeric not null default 0,
  model text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  unique(run_id,account_id)
);

create trigger run_accounts_updated before update on run_accounts for each row execute function set_updated_at();
alter table run_accounts enable row level security;
create policy authenticated_all on run_accounts for all to authenticated using (true) with check (true);
create index run_accounts_run_status on run_accounts(run_id,status,position);
create index run_accounts_account_recent on run_accounts(account_id,finished_at desc);
create index runs_open on runs(started_at desc) where status = 'open';

-- Cards are queried by status and score; surfaced_on is only a "new today" badge.
create index cards_open_score on cards(status,score desc);
