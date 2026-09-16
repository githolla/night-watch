-- Per-user sign-ons: each teammate gets their own email + password login, mapped to a sending seat and a role.
create table if not exists app_users(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique,
  name text not null,
  owner app_owner not null default 'josh',
  role text not null default 'member',
  password_hash text not null,
  last_login_at timestamptz
);
alter table app_users enable row level security;
create policy authenticated_all on app_users for all to authenticated using (true) with check (true);
