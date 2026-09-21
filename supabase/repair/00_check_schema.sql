-- Night Watch: which migrations are actually applied to this database?
-- Read-only. Run this whole block; anything marked MISSING still needs its migration file.
with expected(file, tbl, col) as (values
  ('0002_cadences.sql','cadence_steps','id'),
  ('0002_cadences.sql','cadences','id'),
  ('0003_message_experiments.sql','cards','active_variant_id'),
  ('0003_message_experiments.sql','touches','experiment_variant_id'),
  ('0004_run_accounts.sql','run_accounts','id'),
  ('0005_job_sweep.sql','job_postings','id'),
  ('0006_sweep_sources.sql','job_postings','source'),
  ('0007_posts_and_contacts.sql','public_posts','id'),
  ('0008_account_intel.sql','accounts','intel_score'),
  ('0009_outreach_tiers.sql','accounts','outreach'),
  ('0010_analysis.sql','accounts','analysis'),
  ('0011_contact_details.sql','people','phone'),
  ('0012_analysis_drafts.sql','cards','linkedin_message'),
  ('0013_linkedin_cooldown.sql','accounts','linkedin_checked_at'),
  ('0014_sender_profile.sql','sender_profiles','owner'),
  ('0015_card_claim.sql','cards','working_at'),
  ('0016_linkedin_subject.sql','cards','linkedin_subject'),
  ('0017_google_scopes.sql','gmail_connections','connected_at'),
  ('0017_google_scopes.sql','gmail_connections','scopes'),
  ('0018_scheduling.sql','cards','invite_link'),
  ('0018_scheduling.sql','cards','proposed_times'),
  ('0019_users.sql','app_users','email'),
  ('0020_invites_signature.sql','app_users','invite_token'),
  ('0020_invites_signature.sql','sender_profiles','website'),
  ('0021_pipeline.sql','cards','qualified_at'),
  ('0022_feedback.sql','feedback','message'),
  ('0023_worklist.sql','cards','worklist_on')
)
select file,
       tbl  as table_name,
       col  as column_name,
       case when exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = expected.tbl and c.column_name = expected.col
       ) then 'ok' else 'MISSING' end as state
from expected
order by state desc, file, tbl, col;
