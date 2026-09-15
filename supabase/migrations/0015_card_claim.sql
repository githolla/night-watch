-- Two people work the same desk. A lightweight "someone is on this" marker so they don't double-message the
-- same prospect: set when a card is being worked, shown on the worklist, cleared when it is sent/snoozed/dismissed.
alter table cards
  add column working_at timestamptz,
  add column working_by text;
