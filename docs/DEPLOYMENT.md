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

## Nightly reach-out list and morning auto-send

Apply `supabase/migrations/0027_nightly_lists.sql` and then `0028_ai_fit.sql` first. Until they are applied nothing builds or sends automatically.

Every night `/api/cron/nightly-list` (every ten minutes, 06:00 to 09:50 UTC) builds a list for Josh and for Suuchi:

1. It finds privately held $10M to $100M operating companies in published industry rankings, two sectors a night in rotation, skipping consulting, IT, software and staffing, and anything already contacted, excluded or listed before.
2. It evaluates 20 per person, most promising first by a pre-research score (operations-heavy sector, revenue in the $20M to $80M middle, locations and field crews, and sector reply rates once there are 20 sends to judge by). Reserves from earlier nights are evaluated first and cost nothing. Research finds revenue with its source, the current CEO, President, COO or owner with a source, an optional dated trigger, and the AI-fit evidence, with at most three paid searches and $0.50 per company.
   - **AI fit (0 to 100)** is scored in code (`src/lib/ai-fit.ts`) from sourced, dated facts only: hiring for work a system could do (25), repetitive work at scale (20), change in the last year (20), leadership open to technology (20), and named business systems to build on (15). A disqualifier (a software or IT business, a large in-house AI team, closing down) makes it 0. Companies under `NIGHTLY_LIST_MIN_FIT` (40) are skipped. The score and its linked reasons show on the desk.
3. It finds and checks the buyer's address (published first, then Hunter's finder, then first.last), skipping domains with no mail server and addresses Hunter calls invalid.
4. It writes the three batch-3 email and LinkedIn versions from the approved templates (`src/lib/list-templates.ts`), and skips any company whose copy fails the writer-kit lint or the first-touch rules.
5. When a list has evaluated 20, or the night's $10 budget or the pool runs out, it keeps its 12 best by AI fit (`NIGHTLY_LIST_SIZE`, `NIGHTLY_LIST_RESEARCH`, `NIGHTLY_LIST_BUDGET_USD`). The runners-up become reserves for up to 14 days (`NIGHTLY_LIST_RESERVE_DAYS`). It prepares each kept company as a card, exactly as opening the desk would.

The list appears on the desk as **Today's list**, which becomes the default landing list while it exists.

`/api/cron/morning-send` (every ten minutes, 10:00 to 17:50 UTC) works in local time (`SEND_TIMEZONE`):

- **07:00:** posts the list to Slack, saying whether it will send automatically.
- **09:00 to 11:30:** with auto-send on, sends each confirmed address (Hunter-verified, or already delivered to without a bounce), spread evenly across the window, through the same guards as a Send click: the daily cap, do-not-contact, one email per person, the opt-out line and one-click unsubscribe. Unconfirmed addresses stay on the list for a person to send.
- **After 11:30:** posts a summary.

Auto-send is off by default. Each person turns it on in Settings, and it needs the business postal address saved under Sender identity, because US law (CAN-SPAM) requires it in commercial email. It pauses itself, and says so in Slack, when more than 5% of the day's emails bounce once at least 20 have gone out. Each prospect gets two follow-ups, on business days 3 and 10.
