-- Run only through scripts/test-voice-database.sh against its isolated database.
begin;
insert into people values ('00000000-0000-4000-8000-000000000001','pilot-one@example.test',false), ('00000000-0000-4000-8000-000000000003','pilot-two@example.test',false);
update voice_pilot_config set enabled=false, starts_at=now()-interval '1 hour', ends_at=now()+interval '1 day', daily_limit=1;
insert into voice_eligibility(person_id,timezone,timezone_source,approved_until,approved_by,delay_business_days,approval_basis,approval_evidence,approved_number)
select '00000000-0000-4000-8000-000000000001',name,'Isolated test',now()+interval '1 day','test',1,'written_consent','Test fixture','+15555550100' from pg_timezone_names where extract(isodow from now() at time zone name) between 1 and 5 and extract(hour from now() at time zone name) between 9 and 16 limit 1;
insert into voice_attempts(id,person_id,owner,mode,destination,attempt_key,status,eligibility_expires_at,scheduled_at,context_snapshot,prompt_version)
values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','suuchi','pilot','+15555550100','test-claim','queued',now()+interval '1 day',now()-interval '1 day','{}','test');
do $$ begin
  if exists(select 1 from claim_voice_pilot()) then raise exception 'Disabled pilot claimed a call'; end if;
  update voice_pilot_config set enabled=true;
  if exists(select 1 from claim_voice_pilot()) then raise exception 'Unpassed tests allowed a call'; end if;
  update voice_pilot_config set booking_test_passed=true,voicemail_test_passed=true,optout_test_passed=true;
  update voice_eligibility set approved_number='+15555550199';
  if exists(select 1 from claim_voice_pilot()) then raise exception 'Changed phone number allowed a call'; end if;
  update voice_eligibility set approved_number='+15555550100';
  insert into voice_suppressions values('00000000-0000-4000-8000-000000000001','voice','Test');
  if exists(select 1 from claim_voice_pilot()) then raise exception 'Suppressed contact allowed a call'; end if;
  delete from voice_suppressions;
  if (select count(*) from claim_voice_pilot())<>1 then raise exception 'Approved call was not claimed'; end if;
  if exists(select 1 from claim_voice_pilot()) then raise exception 'Active call was claimed twice'; end if;
  update voice_attempts set status='ended' where attempt_key='test-claim';
  update voice_pilot_config set daily_limit=5;
  update voice_attempts set status='queued' where attempt_key='test-claim';
  if exists(select 1 from claim_voice_pilot()) then raise exception 'Same phone redialed on the same day'; end if;
  update voice_pilot_config set daily_limit=1;
  insert into voice_eligibility select '00000000-0000-4000-8000-000000000003',timezone,timezone_source,approved_until,approved_by,delay_business_days,approval_basis,approval_evidence,'+15555550101' from voice_eligibility limit 1;
  insert into voice_attempts(id,person_id,owner,mode,destination,attempt_key,status,eligibility_expires_at,scheduled_at,context_snapshot,prompt_version) values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','suuchi','pilot','+15555550101','test-second','queued',now()+interval '1 day',now()-interval '1 day','{}','test');
  if exists(select 1 from claim_voice_pilot()) then raise exception 'Daily limit allowed another call'; end if;
end $$;
rollback;
