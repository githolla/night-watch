# Signal discovery

`/discovery` expands Night Watch beyond curated email lists. It collects public hiring signals, company-change leads, buying requests and operator questions, then puts the original source evidence into a human review inbox. The existing `/reddit` approval gate is unchanged.

## What is included

| Source | Access/setup | What is collected |
| --- | --- | --- |
| Greenhouse | Public read API; board ID and known company | Relevant roles and published responsibilities |
| Lever | Public read API; board ID and known company | Relevant roles and published responsibilities |
| GDELT | Open-data API, no key | Article titles and links only |
| Hacker News | Official public API, no key | A bounded sample of recent Ask HN posts matching business keywords |
| SAM.gov | `SAM_API_KEY` from a SAM.gov account | Active solicitations and sources-sought notices, with deadlines when supplied |
| SEC | `SEC_USER_AGENT` containing application name and contact email | Recent 8-K and Form D filing metadata for configured CIKs |
| RSS/Atom | Publisher-permitted feed and recorded usage reference | Published company news and announcements |

No single statement about public visibility grants unrestricted commercial reuse. Follow the relevant source terms, attribution and fair-access requirements. Custom feeds need a permission or licensing reference. The app rejects Reddit feed URLs and Reddit item links; it does not use these adapters to bypass Reddit approval. GDELT access does not grant rights to publisher articles, which the collector does not retrieve. SEC form numbers do not prove funding amounts or acquisitions. SAM contracting contacts are not extracted into the email pipeline.

Official references: [Greenhouse job boards](https://docs.greenhouse.io/job-board.html), [Lever postings](https://github.com/lever/postings-api), [Hacker News API](https://github.com/HackerNews/API), [GDELT data](https://gdeltproject.org/data.html), [SAM public API](https://open.gsa.gov/api/get-opportunities-public-api/), [SEC developer resources](https://www.sec.gov/developer).

## Activation

1. Apply `supabase/migrations/0034_open_discovery.sql`. This optional migration creates four service-role-only tables and two transactional review/queue functions. It depends on the existing nightly-list schema, not on the Reddit migration.
2. Deploy the feature branch. The new Vercel cron calls `/api/cron/discovery` at 06:30 UTC, 2:30am Eastern during daylight saving or 1:30am in winter. It uses the existing `CRON_SECRET`.
3. Open Signal discovery > Sources. The default enabled channels are GDELT, Hacker News and optional SAM. Known active accounts with Greenhouse or Lever boards automatically rotate into remaining source slots. Add more company boards, permitted feeds and SEC company CIKs as needed.
4. The existing `ANTHROPIC_API_KEY` enables evidence assessment. Without it, collection still saves raw discoveries and reports analysis as deferred. `SAM_API_KEY` and `SEC_USER_AGENT` are optional, server-only settings; absence skips those sources without stopping others.
5. Run a small pilot, inspect source coverage and original links, and review relevance before using the results. The nightly channel is enabled by default after migration and deployment. An admin can pause it or change its limits.

The read-only `node --experimental-strip-types scripts/discovery-pilot.ts` pilot reads only GDELT and Hacker News and prints a few public examples. It neither writes to Supabase nor calls a model. In the development check, Hacker News responded successfully; GDELT was unavailable. This is reported as coverage failure rather than treated as an empty search. Other adapters were exercised with synthetic response fixtures, not production credentials.

## Nightly loop and safeguards

- Default limits: six sources, 20 items per source, six model assessments, $2 per run, 30-day retention. Global read ceiling: 80. Work deadline: 220 seconds.
- Each source has a complete, partial, skipped or failed coverage record. All-source failure marks the run failed. Sampling, missing keys, deferred source slots and model backlog are visible. Missing access to one source does not disable others.
- Scheduled runs have one key per Eastern date and a unique running-state lock. Manual discovery shares that lock but has its own run key and budget. An interrupted run is marked failed on the next invocation after ten minutes.
- Canonical source URLs deduplicate results across collectors. Search/tracking parameters are removed from the identity while meaningful item identifiers remain. Source IDs are preserved for attribution and relevance feedback. A full-text feed can replace metadata-only evidence for the same article.
- Discoveries are stored before model analysis. Pending analysis persists between runs, with buying requests and richer sources prioritized. Every evidence quote must occur in the exact title or text before assessment is saved. Source text is untrusted input; the model gets no web or messaging tools.
- Human ownership, notes and company confirmation survive collection refreshes. Changed source evidence clears old assessment and advances the optimistic version. A stale model result or human review cannot overwrite a newer update.
- When a complete job-board response no longer contains an existing role, that hiring signal becomes inactive. A failed or capped board response cannot silently close jobs. Stale evidence, old or future publication dates, inactive roles and expired response deadlines receive no actionable score.
- URL fetching uses the existing DNS/redirect guard, timeouts and response-size limits. XML entity declarations are refused. Raw credentials, API URLs containing secrets, full response bodies and personal contacts are not written to coverage reports.

The score combines fit (40), stated intent (25), actionability (20) and deterministic recency (15). Confidence is separate and capped at 70% for limited-context items. The morning shortlist has up to five relevant records scoring at least 60 with at least 65% confidence. These are review aids, not calibrated purchase probabilities. Unknown budget, authority, size, identity and vendor interest must stay unknown. A hiring signal is not proof of interest in outsourcing.

## Daily review and lead handoff

1. Morning briefing: review the recommended evidence, your due follow-ups and source coverage. Open Inbox for raw records still awaiting analysis.
2. Review: mark relevant or irrelevant, claim an owner, record what was actually learned, and set a reminder.
3. Company confirmation: record a business name, domain and source that establishes that identity. Configuration-supplied identity remains unconfirmed until a person checks it. For discussions, use a voluntarily identified business, never an inferred username-to-person match. Editing the business identity revokes confirmation unless explicitly reconfirmed.
4. Queue company research: an admin can queue a confirmed, owned, active record. Client, do-not-contact, previously contacted and already-handled companies are screened before queuing. A transaction adds or associates one `list_candidates` row and records the handoff. An already-queued company identity cannot be edited silently.
5. Existing pipeline: company-fit, buyer research, email-source evidence and mailbox verification still apply. Unknown revenue is left null rather than fabricated; this can cause the existing nightly list builder to defer or reject a company until its requirements are met. Discovery does not create a person, draft, touch, cadence or send. Inbox ownership is conversation ownership; the existing nightly builder retains its sending-seat assignment rules.
6. Track results: reviewed, research queued, engaged, qualified, meeting or dismissed. Source ordering learns from explicit relevance and outcomes using smoothing, with one rotating exploration source. This is structured prioritization, not model training on source content.

The morning email gains discovery counts and links through the existing digest. No new notification destination is configured. No production digest was sent during implementation.

## Additional tools

- **Company signals:** human-confirmed domains connect hiring, news, filings and requests into one company view. Distinct website counts do not guarantee independent reporting and do not silently inflate the fit score.
- **Recurring problems:** two distinct source URLs are required. Evidence and suggested templates/checklists are shown together. Syndicated coverage of one event may still need manual deduplication before treating it as market demand.
- **Evidence export:** the filtered inbox exports CSV with source links, publication dates, evidence, unknowns and next steps. Spreadsheet formula prefixes are escaped.
- **Retention and deletion:** source records and cascading review events expire after the configured seven to 90 days. Hacker News discussions not rechecked within 72 hours are removed. Housekeeping still runs while discovery is paused. Cleanup requires the cron to execute; monitor failed invocations. Promoted research candidates are separate records and are not removed by deleting the discovery.

Live scope, publisher permissions, production migrations and optional credentials still require deployment-environment verification. Model allowance stops new calls after the cap is reached; an in-flight call can exceed it. Manual runs increase total spend. Sources and coverage are bounded, so the inbox is a set of research opportunities rather than a complete census of business demand.
