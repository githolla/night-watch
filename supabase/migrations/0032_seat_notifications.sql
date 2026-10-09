-- The emails Night Watch sends a seat about its own outreach (morning heads-up, recap, Friday results).
-- One row per seat, kind and day, so each goes out once even if the cron fires twice. Safe to run more
-- than once. Until it is applied the app keeps working: each email is sent in a single ten-minute slot.

create table if not exists seat_notifications(
  owner app_owner not null,
  kind text not null,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (owner, kind, key)
);

alter table seat_notifications enable row level security;
drop policy if exists authenticated_all on seat_notifications;
create policy authenticated_all on seat_notifications for all to authenticated using (true) with check (true);

select 'seat_notifications' as check_name, case when exists (select 1 from information_schema.tables where table_name = 'seat_notifications') then 'ok' else 'missing' end as status;
