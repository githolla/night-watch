create type cadence_mode as enum ('manual','automatic');
create type cadence_status as enum ('draft','active','paused','completed','stopped');
create type cadence_step_kind as enum ('automatic','review');
create type cadence_step_status as enum ('pending','ready','sent','skipped','failed');

create table cadences(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  card_id uuid not null unique references cards on delete cascade,
  person_id uuid not null references people on delete cascade,
  owner app_owner not null,
  mode cadence_mode not null default 'manual',
  status cadence_status not null default 'draft',
  rules jsonb not null default '{}',
  activated_at timestamptz,
  completed_at timestamptz
);

create table cadence_steps(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cadence_id uuid not null references cadences on delete cascade,
  step_number int not null check(step_number between 1 and 12),
  channel touch_channel not null,
  kind cadence_step_kind not null,
  title text not null,
  detail text not null,
  subject text,
  body text,
  status cadence_step_status not null default 'pending',
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  error text,
  unique(cadence_id,step_number)
);

create trigger cadences_updated before update on cadences for each row execute function set_updated_at();
alter table cadences enable row level security;
alter table cadence_steps enable row level security;
create policy authenticated_all on cadences for all to authenticated using (true) with check (true);
create policy authenticated_all on cadence_steps for all to authenticated using (true) with check (true);
create index cadence_steps_due on cadence_steps(status,scheduled_at) where status='pending';
