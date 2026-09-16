-- Tester feedback: one row per submission, captured with who, which page, and when.
create table feedback(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_email text,
  user_name text,
  path text not null default '',
  category text not null default 'other',
  rating int,
  message text not null,
  user_agent text
);
alter table feedback enable row level security;
create policy authenticated_all on feedback for all to authenticated using (true) with check (true);
create index feedback_recent on feedback(created_at desc);
