-- Postings can now come from a board, a sitemap, structured data, or a
-- job-board search; keep the source, and the salary and description when a
-- detail page exposes them.
alter table job_postings
  add column source text not null default 'careers' check (source in ('careers','sitemap','jsonld','web_search')),
  add column salary_max numeric,
  add column description text;
alter table accounts add column job_search_checked_at timestamptz;
create index job_postings_first_seen on job_postings(first_seen_at desc) where active;
