# Deployment

1. Create a Supabase project owned by Nine-67.
2. Run `supabase/migrations/0001_night_watch.sql` in the SQL editor.
3. Create only Josh in Supabase Auth and enable email magic links.
4. Optional: create a Google OAuth web client only if in-app Gmail sending is needed.
5. Create a Vercel project rooted at `night-watch` and copy every variable from `.env.example`.
6. Generate a long random `CRON_SECRET` and `TOKEN_ENCRYPTION_KEY`.
7. Deploy, open Settings, and load the maintained 100-company target universe.
8. Optional: import team LinkedIn exports into `team_connections` for warm-path scoring.
9. Optional: connect Gmail and verify SPF, DKIM, and DMARC before enabling in-app sending.
10. Leave the Vercel schedules enabled.

The schedules in `vercel.json` are UTC: the morning summary at 08:00 EDT, reply, follow-up and Sent-folder checks every 15 minutes, and the feedback digest twice a day. Adjust the fixed UTC schedules when daylight-saving time changes.

Research is not scheduled. Outreach works from the curated lists, so the nightly research, careers sweep and analysis crons were removed from `vercel.json` to stop them spending the model budget. Their routes still exist: an admin can run research from the Runs page, or call `/api/cron/nightly`, `/api/cron/sweep` or `/api/cron/analysis` with `Authorization: Bearer $CRON_SECRET`. Add them back to `vercel.json` to schedule them again.
