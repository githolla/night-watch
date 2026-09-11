-- One score per company from what the sweep found, so lists sort and filter
-- by it in one query and the nightly research goes to the hottest first.
alter table accounts
  add column intel_score int not null default 0,
  add column intel_breakdown jsonb not null default '{}',
  add column open_target_roles int not null default 0,
  add column ai_posts int not null default 0,
  add column contacts int not null default 0,
  add column verified_emails int not null default 0,
  add column last_change_at timestamptz,
  add column intel_updated_at timestamptz;
create index accounts_intel on accounts(intel_score desc) where status = 'active';
create index accounts_last_change on accounts(last_change_at desc) where status = 'active';
