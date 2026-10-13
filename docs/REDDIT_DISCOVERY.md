# Nightly Reddit discovery

Night Watch now has a separate `/reddit` workspace for public conversations about internal automation, CRM hygiene, integrations, handoffs and reporting. It does not convert Reddit usernames into contact records and has no posting, voting or messaging client.

## Activation

1. Apply `supabase/migrations/0033_reddit_opportunities.sql`. The new tables and mutation function are service-role only. This optional migration does not gate the rest of Night Watch.
2. Obtain written Reddit approval for commercial discovery with this app, the chosen communities, retention and the processing described here. Specifically confirm that sending bounded source text to Anthropic for analysis and drafting is within the approved purpose and permitted third-party processing. A credential or subreddit rule is not commercial API approval.
3. Set server-only deployment variables: `REDDIT_COMMERCIAL_APPROVAL_REFERENCE`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN`, `REDDIT_USER_AGENT`, and the existing `ANTHROPIC_API_KEY`. The reference identifies the actual approval, not an arbitrary flag. Use an approved OAuth refresh token with `read` scope and a descriptive Reddit user agent. Never expose these in browser variables.
4. In Reddit opportunities > Settings, select communities and query families, fetch each community's published rules, and review posting, promotion and link restrictions. Fetching resets the response policy to unknown. Only confirm “Helpful business replies permitted” when the rules actually allow the intended participation. Rules expire for drafting after seven days. Collection can include a community where business participation is prohibited, but drafting is blocked.
5. Save enabled settings. Run one manual pilot, check Coverage, then deploy the nightly cron. No code here grants Reddit access or tests production collection automatically.

Official references: [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy), [Data API Terms](https://redditinc.com/policies/data-api-terms), [API reference](https://www.reddit.com/dev/api/), [spam policy](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam).

## The nightly loop

Vercel invokes `/api/cron/reddit` at 07:00 UTC each day, 2am or 3am Eastern depending on daylight saving. It requires `CRON_SECRET`. A per-Eastern-date key prevents duplicate scheduled runs; a unique running-state index prevents concurrent discovery runs. A run interrupted before recording a result becomes failed on the next invocation after ten minutes. A manual run uses a separate key and shares the same running-state lock. Configuration and spending require an admin.

Default limits are five query families, six analyzed threads, four watched-thread refreshes, and a $2 model allowance. Searches use approved OAuth endpoints only, combine selected communities, request newest posts from the past week, and retain a rolling 72-hour window. Each query has at most two pages of 50 results. A run has a 35-read ceiling and a 220-second work deadline. Rate allowance exhaustion, 403, 429, pagination limits and deferred work are reported; there is no scraping fallback. Results are not an exhaustive count of Reddit demand. Manual runs are separately budgeted, so frequent manual runs increase total daily spend.

The selector deduplicates post IDs and retains query provenance. Watched discussions get priority; remaining candidates are ordered by recency. Query ordering uses explicit relevance feedback and qualified outcomes with smoothing, while reserving a rotating exploration query. This is query prioritization from structured outcomes, not model training on Reddit content. Statistics currently cover the retained queue, not a permanent historical attribution dataset.

The app reads a bounded thread context, up to 40 comments, including nested original-poster clarifications. Truncated text and omitted comment branches make coverage partial. Deleted or removed posts are discarded. A watched thread that cannot be refreshed is removed conservatively rather than treated as current. New source content clears old analysis and drafts, preserves human ownership and notes, and surfaces a follow-up flag. The queue also offers deletion of an individual discussion and its audit events.

## Evidence and review

Analysis returns an exact-source evidence quote for every retained opportunity and lists unstated budget, business size and authority as unknown. Quotes are checked against their stated post or comment ID before saving. Text from Reddit is treated as untrusted input. The model has no external search or messaging tools in this workflow.

Scores combine fit (30), request for help (25), stated business context (15), deterministic recency (15) and opportunity to give a useful answer (15). Confidence is shown separately. Locked or archived threads receive no response-opportunity points. The morning shortlist has at most five relevant, recent threads scoring at least 60 with at least 70% confidence. These are judgment aids, not calibrated probabilities or proof of purchasing intent. Human reviewers still check factual claims and the live discussion.

Reply drafts require current reviewed rules. The writer supplies practical advice and an optional checklist or synthetic-demo outline. A separate critic reads the actual source and rejects pitches, unsupported facts and rule violations. A deterministic check also rejects links, email addresses and common contact-routing language. A passed critic does not approve publication. A person reads the thread, edits as necessary, and posts directly on Reddit if appropriate. No replies, DMs, votes or outreach emails are sent by this subsystem.

The recurring-problem board requires at least two distinct discussions. It shows evidence, the original wording and suggested assets. Multiple comments in a single discussion do not inflate demand. Asset output is an outline or checklist suggestion, not a published asset or automatically generated live demo.

## The daily human loop

- Morning: check the briefing and coverage, dismiss unrelated threads, mark relevance, and claim one owner before engaging.
- Contribute: review the live context and rules, copy or adapt a passed draft, post a helpful public answer manually, then record the reply link and stage.
- Follow up: watch active discussions, set a reminder and record real responses. Stages are discovered, reviewed, engaged, responded, contact shared, qualified and meeting, plus dismissed.
- Contact shared: record an address only when it was voluntarily supplied for a business conversation, with evidence of permission. Contact-shared and later stages require that record. It stays separate from the email pipeline and never starts a send.
- Build next: choose a repeated problem with independent evidence, then create a useful template, checklist or synthetic demo. Record relevance and actual conversation outcomes to improve the next night's query priorities.

The existing morning email receives a Reddit summary and review link when the channel is enabled. Incomplete or stale run coverage is reported there. No new notification destination is added. The `/reddit` briefing remains the detailed source of actions and evidence.

## Retention and limitations

The default retention is seven days, configurable from one to 30 days only within the approved agreement. Nightly housekeeping deletes expired discussions, their derivatives, voluntary contact records and cascading audit events. Records not rechecked within 48 hours are also removed, even if collection is disabled. Purging depends on the scheduled endpoint actually running, so monitor cron health and failed runs. Turning off the scheduler does not perform cleanup. If access is revoked, remove stored data as required by the approval and terms rather than relying on the next cron.

Community and query configuration, run counts and costs remain; source content is never written to run reports. Scheduled caps stop new model calls after the allowance is reached; the last in-flight call can exceed it. Manual draft generation has its own per-request allowance. Coverage reports show discovery-call spend; returned manual-draft spend is shown by the request response and is not yet a persistent aggregate spend ledger.

This implementation is ready for a synthetic-data pilot and approved-access setup. Live Reddit behavior, approved scope and production migration application require verification in the deployment environment before activation.
