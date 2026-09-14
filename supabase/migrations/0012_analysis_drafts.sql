-- Drafts written from the agent-swarm analysis, a LinkedIn message on every
-- draft, and job postings the analysis read from public job boards.
alter table cards add column linkedin_message text;
alter table job_postings drop constraint if exists job_postings_source_check;
alter table job_postings add constraint job_postings_source_check check (source in ('careers','sitemap','jsonld','web_search','analysis'));
