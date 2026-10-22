-- Run with scripts/test-voice-database.sh against its isolated database only.
begin;
insert into people values ('00000000-0000-4000-8000-000000000001','buyer@example.test',false);
insert into cadences values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','active');
insert into voice_attempts(id,task_id,person_id,owner,mode,destination,attempt_key,status,context_snapshot,prompt_version,eligibility_expires_at) values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','suuchi','internal','+17177255050','test-internal','active','{}','test',now()+interval '5 minutes');
do $$ begin
  perform suppress_voice_contact('00000000-0000-4000-8000-000000000003','all','test');
  if (select do_not_contact from people limit 1) then raise exception 'Rehearsal suppressed a real person'; end if;
end $$;
update voice_attempts set status='ended';
insert into voice_attempts(id,task_id,person_id,owner,mode,destination,attempt_key,status,context_snapshot,prompt_version,eligibility_expires_at) values ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','suuchi','pilot','+17177255050','test-pilot','active','{}','test',now()+interval '5 minutes');
do $$ begin
  begin
    insert into voice_attempts(task_id,person_id,owner,mode,destination,attempt_key,context_snapshot,prompt_version,eligibility_expires_at) values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','suuchi','pilot','+17177255050','duplicate','{}','test',now());
    raise exception 'Duplicate active call was accepted';
  exception when unique_violation then null; end;
  perform suppress_voice_contact('00000000-0000-4000-8000-000000000004','voice','stop calling');
  if (select do_not_contact from people limit 1) then raise exception 'Voice-only suppression affected email'; end if;
  perform suppress_voice_contact('00000000-0000-4000-8000-000000000004','all','remove me');
  if not (select do_not_contact from people limit 1) then raise exception 'All-channel suppression failed'; end if;
  if (select status from cadences limit 1)<>'stopped' then raise exception 'Cadence was not stopped'; end if;
  perform suppress_voice_contact('00000000-0000-4000-8000-000000000004','voice','stop calling');
  if (select scope from voice_suppressions limit 1)<>'all' then raise exception 'Suppression scope was downgraded'; end if;
end $$;
update people set do_not_contact=false;
update voice_attempts set status='ended';
insert into voice_attempts(id,task_id,person_id,owner,mode,destination,attempt_key,status,context_snapshot,prompt_version,eligibility_expires_at) values ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','suuchi','pilot','+17177255050','queued-reply','queued','{}','test',now()+interval '5 minutes');
insert into touches values ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001',null,now());
do $$ begin
  if (select status from voice_attempts where attempt_key='queued-reply')<>'cancelled' then raise exception 'Reply did not cancel queued call'; end if;
end $$;
rollback;
do $$ begin
  if has_function_privilege('authenticated','suppress_voice_contact(uuid,text,text)','execute') then raise exception 'Authenticated role can invoke service suppression'; end if;
  if has_table_privilege('anon','voice_attempts','select') then raise exception 'Anonymous role can read call context'; end if;
end $$;
