# Deployment

1. Create a Supabase project owned by Nine-67.
2. Run `supabase/migrations/0001_night_watch.sql` in the SQL editor.
3. Create only Josh and Jenna in Supabase Auth and enable email magic links.
4. Create a Google OAuth web client, enable Gmail API, and add `/api/gmail/callback` as an authorized redirect URI.
5. Create a Vercel project rooted at `night-watch` and copy every variable from `.env.example`.
6. Generate a long random `CRON_SECRET` and `TOKEN_ENCRYPTION_KEY`.
7. Deploy, open Settings, and connect each user's Gmail account while signed in as that user.
8. Import accounts into the `accounts` table and team LinkedIn exports into `team_connections`.
9. Verify SPF, DKIM, and DMARC enforcement for `nine-67.com` before sending.
10. Trigger `/api/cron/nightly` with `Authorization: Bearer $CRON_SECRET`, inspect the run, then leave Vercel schedules enabled.

The schedules in `vercel.json` are UTC: nightly research at 01:00 Eastern Daylight Time, summary at 08:00 EDT, and reply checks every 15 minutes. Adjust the two fixed UTC schedules when daylight-saving time changes.
