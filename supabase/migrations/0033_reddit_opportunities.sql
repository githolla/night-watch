create table if not exists reddit_config (
  id boolean primary key default true check (id),
  config jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists reddit_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  status text not null check (status in ('running','complete','partial','failed','disabled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  report jsonb not null default '{}'
);
create table if not exists reddit_opportunities (
  id text primary key,
  source jsonb not null,
  analysis jsonb,
  query_ids text[] not null default '{}',
  status text not null default 'discovered' check (status in ('discovered','reviewed','engaged','responded','contact_shared','qualified','meeting','dismissed')),
  owner app_owner,
  watched boolean not null default false,
  followup_at timestamptz,
  notes text not null default '',
  contact jsonb,
  draft jsonb,
  feedback text check (feedback in ('relevant','irrelevant')),
  changed_at timestamptz,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index if not exists reddit_opportunities_followup on reddit_opportunities(followup_at) where watched;
create table if not exists reddit_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id text not null references reddit_opportunities(id) on delete cascade,
  actor text not null,
  event jsonb not null,
  created_at timestamptz not null default now()
);
alter table reddit_config enable row level security;
alter table reddit_runs enable row level security;
alter table reddit_opportunities enable row level security;
alter table reddit_events enable row level security;
revoke all on reddit_config, reddit_runs, reddit_opportunities, reddit_events from anon, authenticated;
grant all on reddit_config, reddit_runs, reddit_opportunities, reddit_events to service_role;

create or replace function update_reddit_opportunity(p_id text, p_version integer, p_patch jsonb, p_actor text)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update reddit_opportunities set
    status = coalesce(p_patch->>'status', status),
    owner = case when p_patch ? 'owner' then (p_patch->>'owner')::app_owner else owner end,
    watched = coalesce((p_patch->>'watched')::boolean, watched),
    followup_at = case when p_patch ? 'followup_at' then (p_patch->>'followup_at')::timestamptz else followup_at end,
    notes = coalesce(p_patch->>'notes', notes),
    contact = case when p_patch ? 'contact' then p_patch->'contact' else contact end,
    draft = case when p_patch ? 'draft' then p_patch->'draft' else draft end,
    feedback = case when p_patch ? 'feedback' then p_patch->>'feedback' else feedback end,
    version = version + 1, updated_at = now()
  where id = p_id and version = p_version;
  if not found then return false; end if;
  insert into reddit_events(opportunity_id, actor, event) values (p_id, p_actor, p_patch);
  return true;
end $$;
revoke all on function update_reddit_opportunity(text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function update_reddit_opportunity(text, integer, jsonb, text) to service_role;
create unique index if not exists reddit_one_running on reddit_runs ((status)) where status = 'running';
