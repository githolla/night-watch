-- Deep analysis: several model agents read the public web for one company
-- (what is happening, what the hiring means, who decides, what they said) and
-- a synthesizer writes the brief. The result is stored on the account.
alter table accounts
  add column analysis jsonb,
  add column analysis_at timestamptz,
  add column analysis_model text,
  add column analysis_cost_usd numeric not null default 0;
create index accounts_analysis_queue on accounts(analysis_at nulls first) where status = 'active' and outreach;
alter table runs drop constraint if exists runs_source_check;
alter table runs add constraint runs_source_check check (source in ('scheduled','manual','sweep','sweep_manual','analysis','analysis_manual'));
