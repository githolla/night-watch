-- Scheduling: remember the times "Propose times" offered so a reply can be matched to one and booked,
-- and record the resulting calendar invite.
alter table cards add column if not exists proposed_times jsonb;
alter table cards add column if not exists invite_link text;
alter table cards add column if not exists meeting_at timestamptz;
