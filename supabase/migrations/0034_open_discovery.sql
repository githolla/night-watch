create table if not exists discovery_config (
  id boolean primary key default true check(id), config jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists discovery_runs (
  id uuid primary key default gen_random_uuid(), run_key text unique not null,
  status text not null check(status in ('running','complete','partial','failed','disabled')),
  started_at timestamptz not null default now(), finished_at timestamptz, report jsonb not null default '{}'
);
create unique index if not exists discovery_one_running on discovery_runs ((status)) where status = 'running';
create table if not exists discovery_opportunities (
  id text primary key, item jsonb not null, assessment jsonb, source_ids text[] not null default '{}',
  status text not null default 'new' check(status in ('new','reviewed','research_queued','engaged','qualified','meeting','dismissed')),
  owner app_owner, notes text not null default '', feedback text check(feedback in ('relevant','irrelevant')), followup_at timestamptz,
  company_name text, company_domain text, company_evidence_url text, company_confirmed boolean not null default false,
  promoted_candidate_id uuid references list_candidates(id) on delete set null,
  created_at timestamptz not null default now(), checked_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create index if not exists discovery_company on discovery_opportunities(company_domain);
create table if not exists discovery_events (
  id uuid primary key default gen_random_uuid(), opportunity_id text not null references discovery_opportunities(id) on delete cascade,
  actor text not null, event jsonb not null, created_at timestamptz not null default now()
);
alter table discovery_config enable row level security;
alter table discovery_runs enable row level security;
alter table discovery_opportunities enable row level security;
alter table discovery_events enable row level security;
revoke all on discovery_config, discovery_runs, discovery_opportunities, discovery_events from anon, authenticated;
grant all on discovery_config, discovery_runs, discovery_opportunities, discovery_events to service_role;

create or replace function review_discovery(p_id text, p_version integer, p_patch jsonb, p_actor text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update discovery_opportunities set
    status=coalesce(p_patch->>'status',status), owner=case when p_patch ? 'owner' then (p_patch->>'owner')::app_owner else owner end,
    feedback=case when p_patch ? 'feedback' then p_patch->>'feedback' else feedback end,
    followup_at=case when p_patch ? 'followup_at' then (p_patch->>'followup_at')::timestamptz else followup_at end,
    notes=coalesce(p_patch->>'notes',notes),
    company_name=case when p_patch ? 'company_name' then p_patch->>'company_name' else company_name end,
    company_domain=case when p_patch ? 'company_domain' then p_patch->>'company_domain' else company_domain end,
    company_evidence_url=case when p_patch ? 'company_evidence_url' then p_patch->>'company_evidence_url' else company_evidence_url end,
    company_confirmed=coalesce((p_patch->>'company_confirmed')::boolean,company_confirmed),
    version=version+1, updated_at=now()
  where id=p_id and version=p_version;
  if not found then return false; end if;
  insert into discovery_events(opportunity_id,actor,event) values(p_id,p_actor,p_patch);
  return true;
end $$;
revoke all on function review_discovery(text,integer,jsonb,text) from public,anon,authenticated;
grant execute on function review_discovery(text,integer,jsonb,text) to service_role;

create or replace function queue_discovery_company(p_id text, p_version integer, p_actor text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare opportunity discovery_opportunities; candidate_id uuid;
begin
  select * into opportunity from discovery_opportunities where id=p_id for update;
  if not found or opportunity.version <> p_version then raise exception 'Conversation changed. Refresh first.'; end if;
  if opportunity.promoted_candidate_id is not null then return opportunity.promoted_candidate_id; end if;
  if not opportunity.company_confirmed or opportunity.company_domain is null or opportunity.company_name is null or opportunity.company_evidence_url is null then raise exception 'Confirm the company and its domain with a source first.'; end if;
  if opportunity.status='dismissed' or opportunity.feedback='irrelevant' or opportunity.item->>'active' <> 'true' then raise exception 'This opportunity is not eligible for company research.'; end if;
  if opportunity.owner is null then raise exception 'Assign an owner first.'; end if;
  if exists(select 1 from accounts where domain=opportunity.company_domain and status in ('client','do_not_contact')) then raise exception 'Company is excluded from outreach.'; end if;
  insert into list_candidates(company,domain,source_url) values(opportunity.company_name,opportunity.company_domain,opportunity.company_evidence_url)
    on conflict(domain) do nothing returning id into candidate_id;
  if candidate_id is null then select id into candidate_id from list_candidates where domain=opportunity.company_domain; end if;
  update discovery_opportunities set promoted_candidate_id=candidate_id,status='research_queued',version=version+1,updated_at=now() where id=p_id;
  insert into discovery_events(opportunity_id,actor,event) values(p_id,p_actor,jsonb_build_object('action','research_queued','candidate_id',candidate_id));
  return candidate_id;
end $$;
revoke all on function queue_discovery_company(text,integer,text) from public,anon,authenticated;
grant execute on function queue_discovery_company(text,integer,text) to service_role;
