-- The identity outreach emails are sent as: a display name and title on the From line, a signature appended to
-- the body, and a CC list (e.g. the rest of the team). The mailbox itself is the connected Gmail for the owner;
-- this only controls how that mailbox presents. One row per owner slot.
create table sender_profiles(
  owner app_owner primary key,
  from_name text not null default '',
  title text not null default '',
  signature text not null default '',
  cc text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into sender_profiles(owner, from_name, title) values ('josh', 'Suuchi Ramesh', 'Founder & CEO') on conflict (owner) do nothing;
