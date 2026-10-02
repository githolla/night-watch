-- Send safety for the morning auto-send and automatic follow-ups. Safe to run more than once; apply after 0027.
--
-- Until it is applied the app keeps working: the bounce brake counts from 7 days back, the per-card hold and
-- one-day skip are simply unavailable, held reasons are not saved, and sent counts use a read-and-add.

-- When a person last resumed auto-send. The bounce brake only counts first emails sent after it, so bounces
-- that caused the last pause cannot pause the seat again.
alter table sender_profiles add column if not exists auto_send_resumed_at timestamptz;

-- "Skip today": no automatic first emails for this seat on this local date.
alter table sender_profiles add column if not exists auto_send_skip_on date;

-- "Keep for me": this card is sent by hand only. And why the morning run left a card unsent, for the summary.
alter table cards add column if not exists auto_send_hold boolean not null default false;
alter table cards add column if not exists auto_send_hold_reason text;

-- Opt-outs are checked by address across every people row, case-insensitively.
create index if not exists people_email_lower on people (lower(email)) where email is not null;

-- Morning sends counted without a lost update when two runs overlap.
create or replace function increment_list_sent(list_id uuid, amount int) returns int
language sql
as $$
  update reachout_lists set sent_count = sent_count + amount, updated_at = now() where id = list_id returning sent_count;
$$;
revoke all on function increment_list_sent(uuid, int) from public, anon, authenticated;
grant execute on function increment_list_sent(uuid, int) to service_role;
