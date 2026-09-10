-- Job sweep: read every company's careers page or applicant-tracking board
-- directly, no model involved, and keep every posting with first/last seen.
alter table accounts
  add column ats_provider text,
  add column ats_ref text,
  add column careers_checked_at timestamptz,
  add column careers_status text check (careers_status in ('found','listings','none','error')),
  add column careers_note text;

create table job_postings(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  account_id uuid not null references accounts on delete cascade,
  external_id text,
  title text not null,
  url text not null,
  location text,
  department text,
  family text,
  posted_at date,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active boolean not null default true,
  raw jsonb not null default '{}',
  unique(account_id,url)
);

create trigger job_postings_updated before update on job_postings for each row execute function set_updated_at();
alter table job_postings enable row level security;
create policy authenticated_all on job_postings for all to authenticated using (true) with check (true);
create index job_postings_account_active on job_postings(account_id,active,family);
create index job_postings_family_active on job_postings(family,active) where family is not null;

-- Sweeps are runs too, so the run panel and history read them the same way.
alter table runs drop constraint if exists runs_source_check;
alter table runs add constraint runs_source_check check (source in ('scheduled','manual','sweep','sweep_manual'));
alter table run_accounts add column note text;
create index accounts_careers_queue on accounts(careers_checked_at nulls first) where status = 'active';
