create table voice_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task_id uuid references cadences(id),
  person_id uuid references people(id),
  owner app_owner not null,
  mode text not null default 'internal' check (mode in ('internal', 'pilot')),
  destination text not null,
  attempt_key text not null unique,
  status text not null default 'creating' check (status in ('queued','creating','active','ended','held','cancelled')),
  vapi_call_id text unique,
  context_snapshot jsonb not null,
  prompt_version text not null,
  eligibility_expires_at timestamptz not null,
  ended_reason text,
  report jsonb,
  review_required boolean not null default false
);
create unique index voice_one_active_contact on voice_attempts(person_id, mode) where person_id is not null and status in ('queued','creating','active');
create table voice_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  attempt_id uuid not null references voice_attempts(id),
  tool_call_id text not null,
  kind text not null,
  status text not null default 'processing' check (status in ('processing','queued','confirmed','simulated','held')),
  details jsonb not null default '{}',
  result jsonb,
  unique(attempt_id, tool_call_id)
);
create table voice_slots (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references voice_attempts(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  prospect_requested boolean not null default false,
  expires_at timestamptz not null,
  unique(attempt_id, start_at)
);
create table voice_suppressions (
  person_id uuid primary key references people(id),
  scope text not null check (scope in ('voice','all')),
  reason text not null,
  created_at timestamptz not null default now()
);
alter table voice_attempts enable row level security;
alter table voice_actions enable row level security;
alter table voice_slots enable row level security;
alter table voice_suppressions enable row level security;

create function suppress_voice_contact(p_attempt uuid, p_scope text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a voice_attempts;
begin
  select * into a from voice_attempts where id=p_attempt for update;
  if not found or a.person_id is null or p_scope not in ('voice','all') then raise exception 'Invalid suppression context'; end if;
  if a.mode='internal' then return jsonb_build_object('status','simulated','scope',p_scope); end if;
  insert into voice_suppressions(person_id,scope,reason)
  select id,p_scope,p_reason from people where id=a.person_id or (email is not null and lower(email)=(select lower(email) from people where id=a.person_id))
  on conflict(person_id) do update set scope=case when voice_suppressions.scope='all' then 'all' else excluded.scope end, reason=excluded.reason;
  update voice_attempts set status='cancelled' where person_id in (select person_id from voice_suppressions) and status in ('queued','creating') and id<>a.id;
  if p_scope='all' then
    update people set do_not_contact=true where id=a.person_id or (email is not null and lower(email)=(select lower(email) from people where id=a.person_id));
    update cadences set status='stopped' where person_id in (select id from people where do_not_contact=true);
    update cadence_steps set status='skipped',error='Contact opted out during a voice call' where cadence_id in (select id from cadences where status='stopped') and status in ('pending','ready','failed') and sent_at is null;
  end if;
  return jsonb_build_object('status','confirmed','scope',p_scope);
end $$;
revoke all on function suppress_voice_contact(uuid,text,text) from public, anon, authenticated;
grant execute on function suppress_voice_contact(uuid,text,text) to service_role;

create function hold_voice_on_contact_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='touches' then
    if new.bounced_at is not null or new.reply_at is not null then
      update voice_attempts set status='cancelled', review_required=true where person_id=new.person_id and status in ('queued','creating');
    end if;
  elsif new.do_not_contact then
    update voice_attempts set status='cancelled', review_required=true where person_id=new.id and status in ('queued','creating');
  end if;
  return new;
end $$;
create trigger voice_cancel_on_touch after insert or update of bounced_at,reply_at on touches for each row execute function hold_voice_on_contact_change();
create trigger voice_cancel_on_optout after update of do_not_contact on people for each row execute function hold_voice_on_contact_change();

create function hold_voice_on_meeting() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='meeting' then
    update voice_attempts set status='cancelled', review_required=true where person_id=new.person_id and status in ('queued','creating');
  end if;
  return new;
end $$;
create trigger voice_cancel_on_meeting after update of status on cards for each row execute function hold_voice_on_meeting();

create table voice_eligibility (
  person_id uuid primary key references people(id),
  timezone text not null,
  timezone_source text not null,
  approved_until timestamptz not null,
  approved_by text not null,
  delay_business_days integer not null default 1 check (delay_business_days between 1 and 5)
);
alter table voice_eligibility enable row level security;
alter table voice_attempts add column scheduled_at timestamptz;
revoke all on voice_attempts, voice_actions, voice_slots, voice_suppressions, voice_eligibility from anon, authenticated;
grant all on voice_attempts, voice_actions, voice_slots, voice_suppressions, voice_eligibility to service_role;
