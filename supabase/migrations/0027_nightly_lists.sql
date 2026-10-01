-- Nightly reach-out lists and the morning auto-send.
--
-- Safe to run more than once. Until it is applied nothing builds or sends automatically; the existing
-- First 25 / Next 25 lists keep working.

-- Companies found in published industry rankings, waiting to be researched. One row per domain, so a
-- company is never researched twice and never lands on two lists.
create table if not exists list_candidates(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company text not null,
  domain text not null unique,
  sector text not null default '',
  revenue_usd_m numeric,
  revenue_year int,
  source_url text,
  status text not null default 'new' check (status in ('new','researching','listed','skipped')),
  owner app_owner,
  list_date date,
  skip_reason text,
  cost_usd numeric not null default 0
);
create index if not exists list_candidates_queue on list_candidates(status, revenue_usd_m desc);

-- One list per seat per morning. `rows` holds list items in the same shape as the researched batch files
-- (data/batch-3-focus.json), `offers` the three email/LinkedIn versions per contact (batch-3-offers.json),
-- so the desk, card preparation and the research panel treat a nightly list like the curated ones.
create table if not exists reachout_lists(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  list_date date not null,
  owner app_owner not null,
  status text not null default 'building' check (status in ('building','ready','failed')),
  rows jsonb not null default '[]',
  offers jsonb not null default '[]',
  attempts int not null default 0,
  cost_usd numeric not null default 0,
  errors jsonb not null default '[]',
  announced_at timestamptz,
  sent_count int not null default 0,
  held_count int not null default 0,
  summary_posted_at timestamptz,
  unique(list_date, owner)
);

-- Per-seat morning auto-send. Off until the person turns it on; the postal address is required in the
-- footer of commercial email (CAN-SPAM), so auto-send refuses to run without it.
alter table sender_profiles add column if not exists postal_address text not null default '';
alter table sender_profiles add column if not exists auto_send boolean not null default false;
alter table sender_profiles add column if not exists auto_send_paused boolean not null default false;
alter table sender_profiles add column if not exists auto_send_paused_reason text;

-- When a delivery failure came back for this send. Feeds the bounce brake that pauses auto-send.
alter table touches add column if not exists bounced_at timestamptz;

alter table list_candidates enable row level security;
alter table reachout_lists enable row level security;
