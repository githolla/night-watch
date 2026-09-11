-- Public posts about AI by people at target companies, and contact
-- enrichment as part of the sweep.
create table public_posts(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  account_id uuid not null references accounts on delete cascade,
  person_id uuid references people on delete set null,
  author_name text not null,
  author_title text not null default '',
  url text not null,
  platform text not null default '',
  topic text not null default '',
  excerpt text not null,
  posted_at date,
  found_by text not null default '',
  raw jsonb not null default '{}',
  unique(account_id,url)
);
alter table public_posts enable row level security;
create policy authenticated_all on public_posts for all to authenticated using (true) with check (true);
create index public_posts_recent on public_posts(created_at desc);

alter table accounts
  add column ai_posts_checked_at timestamptz,
  add column contacts_checked_at timestamptz;
alter table people
  add column enriched_at timestamptz,
  add column source text not null default 'signal';
create index people_enriched on people(enriched_at desc) where enriched_at is not null;
