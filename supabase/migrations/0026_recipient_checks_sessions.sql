-- Recipient checks, bounce learning, and server-side session revocation.
--
-- Safe to run more than once. The app works before this is applied: checks are simply not remembered
-- between sends, bounces are not recorded, and sign-out only clears the browser's cookie.

-- A bounced or verifier-rejected address. Every send path refuses it until someone fixes the address.
alter type email_status add value if not exists 'invalid';

-- What the last recipient check found (Hunter verdict, mail server, company format, suggestion) and the
-- delivery history used for bounce learning (lastSentEmail / lastSentAt / bouncedEmail).
alter table people add column if not exists email_check jsonb;

-- Bumped when a password is reset; sessions issued under an older value stop working.
alter table app_users add column if not exists session_version int not null default 0;

-- Token ids signed out before they expired. Rows are pruned once past expires_at.
create table if not exists revoked_sessions(
  jti text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists revoked_sessions_expires on revoked_sessions(expires_at);
alter table revoked_sessions enable row level security;
