-- LinkedIn discovery (profile + post search) is the sweep's largest recurring model cost. It changes little
-- day to day, so it should run on a cooldown like the AI-posts and contacts passes, not on every sweep.
alter table accounts add column linkedin_checked_at timestamptz;
