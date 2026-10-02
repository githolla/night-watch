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

Apply these migrations in order in the Supabase SQL editor; each is safe to run more than once:

- `0027_nightly_lists.sql` and `0028_ai_fit.sql`: until they are applied nothing builds or sends automatically.
- `0029_nightly_resilience.sql`: research retries, preparation tracking and the build alerts.
- `0030_send_safety.sql`: the per-card "Keep for me" hold, "Skip today", the resume time the bounce brake counts from, saved held reasons, case-insensitive opt-out lookup and the atomic sent count. Until it is applied those controls are hidden or refused with a message, and the rest keeps working.

Lists build and auto-send only on send days: `SEND_DAYS` (default `Mon,Tue,Wed,Thu,Fri`), minus any date in `SKIP_DATES`, a comma-separated list of `YYYY-MM-DD` dates in the send timezone (use it for US holidays, for example `SKIP_DATES=2026-11-26,2026-12-25`).

Every night `/api/cron/nightly-list` (every ten minutes, 06:00 to 09:50 UTC) builds a list for Josh and for Suuchi:

1. It finds privately held $10M to $100M operating companies in published industry rankings, two sectors a night in rotation, skipping consulting, IT, software and staffing, and anything already contacted, excluded or listed before.
2. It evaluates 20 per person, most promising first by a pre-research score (operations-heavy sector, revenue in the $20M to $80M middle, locations and field crews, and sector reply rates once there are 20 sends to judge by). Reserves from earlier nights are evaluated first and cost nothing. Research finds revenue with its source, the current CEO, President, COO or owner with a source, an optional dated trigger, and the AI-fit evidence, with at most three paid searches and $0.50 per company.
   - **AI fit (0 to 100)** is scored in code (`src/lib/ai-fit.ts`) from sourced, dated facts only: hiring for work a system could do (25), repetitive work at scale (20), change in the last year (20), leadership open to technology (20), and named business systems to build on (15). A disqualifier (a software or IT business, a large in-house AI team, closing down) makes it 0. Companies under `NIGHTLY_LIST_MIN_FIT` (40) are skipped. The score and its linked reasons show on the desk.
3. It finds and checks the buyer's address (published first, then Hunter's finder, then first.last), skipping domains with no mail server and addresses Hunter calls invalid.
4. It writes the three batch-3 email and LinkedIn versions from the approved templates (`src/lib/list-templates.ts`), and skips any company whose copy fails the writer-kit lint or the first-touch rules.
5. When a list has evaluated 20, or the night's $10 budget or the pool runs out, it keeps its 12 best by AI fit (`NIGHTLY_LIST_SIZE`, `NIGHTLY_LIST_RESEARCH`, `NIGHTLY_LIST_BUDGET_USD`). The runners-up become reserves for up to 14 days (`NIGHTLY_LIST_RESERVE_DAYS`). It prepares each kept company as a card, exactly as opening the desk would.

The list appears on the desk as **Today's list**, which becomes the default landing list while it exists. It opens in send order (list rank, then AI fit), and each row shows its fit score, the year its revenue was reported for, and what the morning run is expected to do with it: sent (with the time), auto-send off, paused or skipped, kept for you, expected to auto-send, or needs a hand send because the address is not confirmed. The last two are predictions; the real checks run at send time.

`/api/cron/morning-send` (every ten minutes, 10:00 to 17:50 UTC) works in local time (`SEND_TIMEZONE`):

- **First run of the morning:** finalizes any list the night left building, with the companies it has, and prepares cards for rows that have none. A stuck list never needs a person to close it.
- **07:00 (`LIST_ANNOUNCE_AT`):** posts the list to Slack, one line per company with its fit and whether it is expected to send or held and why. When there is no usable list (never built, still building or failed) it posts one alert with the top reasons instead.
- **09:00 to 11:30 (`AUTO_SEND_FROM`, `AUTO_SEND_UNTIL`):** with auto-send on, sends each confirmed address (Hunter-verified, or already delivered to without a bounce), spread evenly across the window with a random wait before each, through the same guards as a Send click: the daily cap, do-not-contact, one email per person, the opt-out line and one-click unsubscribe. Unconfirmed addresses stay on the list for a person to send.
- **After 11:30:** posts a summary naming every card left unsent and why, and how many you kept to send by hand.

The 8:00 card digest (`/api/cron/morning`) is skipped for a seat whose list is ready, so each person gets one morning message.

**The cron hours assume US Eastern.** The `vercel.json` schedules are fixed UTC hours chosen so 7:00 to 11:30 Eastern falls inside the 10:00 to 17:50 UTC morning-send cron in both EDT and EST. If you change `SEND_TIMEZONE`, `LIST_ANNOUNCE_AT`, `AUTO_SEND_FROM` or `AUTO_SEND_UNTIL`, check the morning-send hours in `vercel.json` too; the 7:00 Slack message warns when part of the morning falls outside them.

Auto-send is off by default. Each person turns it on in Settings, and it needs the business postal address saved under Sender identity, because US law (CAN-SPAM) requires it in commercial email. Each prospect gets two follow-ups, on business days 3 and 10.

- **Bounce brake:** auto-send pauses itself, and says in Slack which addresses bounced, after 2 bounced first emails within 48 hours, or when more than 5% of at least 10 first emails bounce. Pausing also holds automatic follow-ups. After fixing the addresses, Resume in Settings; the brake then counts only first emails sent after the resume.
- **Follow-ups** for a seat without a postal address wait for a person, the same rule as first emails.
- **Signature:** automatically sent first emails use a plain-text signature (name and details, no logo or images, at most one link). Emails you send by hand keep the saved signature.
- **Keep for me:** on Today's list, the "Keep for me (don't auto-send)" toggle next to Send takes one company off the morning auto-send without dismissing it. You can still send it yourself.
- **Skip today:** the Settings button stops this morning's automatic first emails for that seat only; it clears itself tomorrow. Pause is the longer stop and also holds follow-ups.
- **Warm-up:** a newly connected mailbox starts at 5 emails a day and adds `SEND_RAMP_PER_DAY` (default 5) each day up to `SEND_DAILY_CAP` (default 40). Settings shows today's cap and how long Gmail has been connected. For a genuinely new domain or mailbox, set `SEND_RAMP_PER_DAY=2` or `3` for a slower ramp.

Settings also shows tonight's build per seat (companies evaluated against the target, the fit range kept, when the 7:00 and summary messages went out, and the top skip reasons with the skipped companies) and the night's research spend once, because the $10 budget is shared by both lists. `/stats` shows list outcomes by AI-fit band and sector, and suggests a `NIGHTLY_LIST_MIN_FIT` once there are enough replies; it never changes the setting.
