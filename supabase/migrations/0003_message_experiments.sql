create type message_experiment_status as enum ('draft','simulated','selected','sent','completed');

create table message_experiments(
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

create table message_variants(
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

alter table cards add column active_variant_id uuid references message_variants on delete set null;
alter table touches add column experiment_variant_id uuid references message_variants on delete set null;

create trigger message_experiments_updated before update on message_experiments for each row execute function set_updated_at();
alter table message_experiments enable row level security;
alter table message_variants enable row level security;
create policy authenticated_all on message_experiments for all to authenticated using (true) with check (true);
create policy authenticated_all on message_variants for all to authenticated using (true) with check (true);
create index message_experiments_card on message_experiments(card_id,created_at desc);
create index message_variants_experiment on message_variants(experiment_id);
