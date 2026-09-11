-- The reach-out cut. Every company carries its tier from the workbook; only
-- Tier A (A1, A2) is contacted. The reach-out flag can be set by hand to
-- promote a hold-list company or pull one back, and stays put across syncs.
alter table accounts
  add column tier text,
  add column drop_reason text,
  add column outreach boolean not null default false,
  -- null: follow the tier. true/false: someone decided by hand.
  add column outreach_manual boolean,
  add column outreach_owner text,
  add column outreach_stage text not null default 'untouched',
  add column outreach_notes text,
  add column outreach_updated_at timestamptz;
create index accounts_outreach on accounts(outreach, tier) where status = 'active';
