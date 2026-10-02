-- Nightly list resilience. Safe to run more than once; apply after 0028.
--
-- Until it is applied the nightly build keeps working: a company cut off mid-research simply goes back in
-- the queue every time, skipped companies are never retried, card preparation is re-checked against the
-- cards each morning, and a failed build is reported only by the 7:00 alert.

-- How many times research on this company was started. A company cut off twice is skipped, which caps
-- what one company can cost at two research allowances.
alter table list_candidates add column if not exists research_attempts int not null default 0;

-- How many times a skipped company was put back in the queue. One retry, 30 days on, after a transient
-- failure or a near-miss fit.
alter table list_candidates add column if not exists retry_count int not null default 0;

-- When every kept company on a ready list had a card prepared or a final outcome recorded.
alter table reachout_lists add column if not exists prepared_at timestamptz;

-- When the nightly route last posted a failure alert for this date, so it posts at most once a night.
alter table reachout_lists add column if not exists alerted_at timestamptz;

create index if not exists list_candidates_researching on list_candidates(list_date) where status = 'researching';
create index if not exists list_candidates_retry on list_candidates(researched_at) where status = 'skipped' and retry_count = 0;
