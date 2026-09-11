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
10. Trigger `/api/cron/nightly` with `Authorization: Bearer $CRON_SECRET`, inspect the run, then leave Vercel schedules enabled.

The schedules in `vercel.json` are UTC: nightly research at 01:00 Eastern Daylight Time, summary at 08:00 EDT, and reply checks every 15 minutes. Adjust the two fixed UTC schedules when daylight-saving time changes.
