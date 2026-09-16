-- Invited users set their own password via a link, so a hash isn't required up front.
alter table app_users alter column password_hash drop not null;
alter table app_users add column if not exists invite_token text;
alter table app_users add column if not exists invite_expires_at timestamptz;
create index if not exists app_users_invite on app_users(invite_token) where invite_token is not null;

-- Structured fields for the branded email signature block (name/title/signature/cc already exist).
alter table sender_profiles add column if not exists website text not null default '';
alter table sender_profiles add column if not exists location text not null default '';
