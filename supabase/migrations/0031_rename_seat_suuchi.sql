-- Rename Suuchi's seat from its legacy key "jenna" to "suuchi". Safe to run more than once; apply after 0030.
--
-- Renaming an enum value updates every row that uses it at once (cards, touches, gmail_connections,
-- sender_profiles, app_users, cadences, lists), so nothing else needs rewriting. Run it right after the
-- matching deploy goes live: until then the app asks for this file instead of sending from her seat.

do $$
begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'app_owner' and e.enumlabel = 'jenna') then
    alter type app_owner rename value 'jenna' to 'suuchi';
  end if;
end $$;

-- The free-text outreach owner on accounts may still hold the old key.
update accounts set outreach_owner = 'suuchi' where lower(outreach_owner) = 'jenna';
