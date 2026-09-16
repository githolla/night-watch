-- Post-outreach conversion stages: after a meeting, a card can be qualified, then an opportunity.
alter type card_status add value if not exists 'qualified';
alter type card_status add value if not exists 'opportunity';

-- When each stage happened (for the conversion funnel) plus a note and a rough opportunity value.
alter table cards add column if not exists qualified_at timestamptz;
alter table cards add column if not exists opportunity_at timestamptz;
alter table cards add column if not exists opportunity_value_usd int;
alter table cards add column if not exists stage_note text;
