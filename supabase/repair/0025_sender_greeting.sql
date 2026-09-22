-- Per-seat greeting and sign-off.
--
-- The draft writer supplies the argument, not the manners: how an email opens and closes belongs to the
-- person sending it, so Suuchi's drafts read the way she writes and Josh's read the way he does. Every
-- draft is composed with the seat's own lines rather than one hard-coded "Hi {first}," for everybody.
--
-- Safe to run more than once. Both columns are nullable with no default, and the code treats empty as
-- "use the built-in line", so nothing changes for a seat that has set neither.
--
-- {first} is replaced by the contact's first name and {name} by their full name.

alter table public.sender_profiles add column if not exists greeting text;
alter table public.sender_profiles add column if not exists signoff  text;

comment on column public.sender_profiles.greeting is 'Opening line for this seat''s drafts. {first} and {name} are filled per contact. Empty means "Hi {first},".';
comment on column public.sender_profiles.signoff  is 'Closing line for this seat''s drafts. Empty means "Thank you,".';

-- What each seat has set, to confirm the change landed.
select owner, coalesce(nullif(greeting, ''), '(default: Hi {first},)') as greeting,
              coalesce(nullif(signoff,  ''), '(default: Thank you,)')  as signoff
from public.sender_profiles order by owner;
