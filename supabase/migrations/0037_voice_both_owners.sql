create or replace function claim_voice_pilot() returns setof voice_attempts
language plpgsql security definer set search_path=public as $$
declare c voice_pilot_config; a voice_attempts; used integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('nightwatch-voice-pilot')) then return; end if;
  select * into c from voice_pilot_config where id=true for update;
  if not found or not c.enabled or not c.booking_test_passed or not c.voicemail_test_passed or not c.optout_test_passed
    or now()<c.starts_at or now()>=c.ends_at then return; end if;
  if exists(select 1 from voice_attempts where mode='pilot' and (status in ('creating','active') or (status='held' and review_required and dispatched_at>=c.starts_at))) then return; end if;
  select count(*) into used from voice_attempts where mode='pilot' and dispatched_at >= (date_trunc('day',now() at time zone 'America/New_York') at time zone 'America/New_York');
  if used>=c.daily_limit then return; end if;
  select v.* into a from voice_attempts v join voice_eligibility e on e.person_id=v.person_id
  where v.mode='pilot' and v.owner in ('josh','suuchi') and v.status='queued' and v.scheduled_at<=now()
    and v.eligibility_expires_at>now() and e.approved_until>now()
    and length(trim(e.timezone_source))>0 and length(trim(e.approved_by))>0
    and e.approval_basis is not null and length(trim(e.approval_evidence))>0 and e.approved_number=v.destination
    and e.timezone in (select name from pg_timezone_names)
    and extract(isodow from now() at time zone e.timezone) between 1 and 5
    and extract(hour from now() at time zone e.timezone) between 9 and 16
    and not exists(select 1 from voice_suppressions s where s.person_id=v.person_id)
    and not exists(select 1 from voice_attempts p where p.mode='pilot' and p.destination=v.destination and p.dispatched_at >= (date_trunc('day',now() at time zone 'America/New_York') at time zone 'America/New_York'))
  order by v.scheduled_at,v.created_at limit 1 for update of v skip locked;
  if not found then return; end if;
  return query update voice_attempts set status='creating', dispatched_at=now() where id=a.id and status='queued' returning *;
end $$;
revoke all on function claim_voice_pilot() from public, anon, authenticated;
grant execute on function claim_voice_pilot() to service_role;
