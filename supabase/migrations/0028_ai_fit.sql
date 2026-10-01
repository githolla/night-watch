-- AI-fit selection for the nightly list. Safe to run more than once; apply after 0027.
--
-- Each candidate keeps a cheap pre-research score (queue order), the sourced AI-fit score and evidence
-- found by research, and, when it scored well but missed the night's cut, its finished list row so a later
-- night can use it without paying to research it again.

alter table list_candidates add column if not exists sector_key int;
alter table list_candidates add column if not exists prior_score numeric not null default 0;
alter table list_candidates add column if not exists fit_score int;
alter table list_candidates add column if not exists fit jsonb;
alter table list_candidates add column if not exists prepared jsonb;
alter table list_candidates add column if not exists researched_at timestamptz;

alter table list_candidates drop constraint if exists list_candidates_status_check;
alter table list_candidates add constraint list_candidates_status_check check (status in ('new','researching','listed','skipped','reserve'));

create index if not exists list_candidates_prior on list_candidates(status, prior_score desc);
create index if not exists list_candidates_reserve on list_candidates(fit_score desc) where status = 'reserve';
