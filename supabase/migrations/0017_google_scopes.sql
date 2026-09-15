-- Track what each connected Google account granted, so the app knows whether Calendar
-- (for "Propose times") is available and can show the real connected address.
alter table gmail_connections add column if not exists scopes text;
alter table gmail_connections add column if not exists calendar boolean not null default false;
alter table gmail_connections add column if not exists connected_at timestamptz;
