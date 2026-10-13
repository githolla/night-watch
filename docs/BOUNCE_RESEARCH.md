# Bounce research loop

The existing `/api/cron/replies` poll collects delivery failures every 15 minutes. It reads the failed recipient, original failure time, message ID, SMTP status, and diagnostic. It matches that address to the contact's current address or saved outbound thread receipt. Bounce updates are scoped to the sender, card, and person so a shared Gmail thread cannot contaminate an unrelated test record. Invalid mailboxes and restricted groups stop their sequences. Temporary failures are recorded as delays and hold follow-ups without permanently rejecting the mailbox.

Each contact retains all rejected addresses and delivery reports in `email_check`, even when its address changes. Every send-time verification and address import checks failed-address history across contacts. These reads fail closed. A mail server accepting a send, or the absence of an immediate bounce, never establishes verified delivery.

## Research and verification

The existing `/api/cron/addresses` schedule runs every 20 minutes. Fresh failures bypass a previous site-search cooldown. Unresolved failures are attempted once per 24 hours, oldest attempts first within each priority group; other unverified contacts retain the weekly research interval. Each invocation works at most eight contacts within its time budget and saves its research outcome.

The worker first checks a saved replacement with Hunter, then searches company pages, prioritizing actual links and following individual staff biographies. It can find a company-published address on an alternate mail domain. For unresolved failures, `ANTHROPIC_API_KEY` enables broader searches of associations, company releases, and public business documents. Each contact's broader search uses at most three searches, 1,500 output tokens, a 60-second timeout, and the existing research budget mechanism with a $0.25 allowance. The provider's billed spend is recorded after its calls.

Every citation is fetched again through the existing public-host and redirect checks. Published evidence must associate the named person and exact address. PDF citations are text-extracted with `unpdf`, limited to 12 MB of input and 250 pages. Scanned images without extractable text do not establish evidence. An alternate email domain requires a citation on the company's own site.

Publication and colleague patterns save candidates as unverified. They do not reopen bounced cards. Only a mailbox verification that also passes the personal-address check releases a replacement. Unknown results, catch-all domains, provider errors, and unavailable verification stay held. Manual single-email sending can still use an unconfirmed address, but never an address with negative history. Automatic sending and Send all ready require verified personal mailboxes and repeat the check at send time.

## Configuration and reporting

- `HUNTER_API_KEY`: enables mailbox verification. Without it, candidates stay held for automatic sending.
- `ANTHROPIC_API_KEY`: enables broader web research after the company-site search. Without it, the worker still searches the company's own site and accepts evidence supplied by an external research routine.
- Existing cron authorization and list-import authorization remain required. No new database migration or cron schedule is needed.

The morning briefing reports unresolved failures, replacement candidates awaiting verification, and how many contacts were researched in the previous day. It explicitly says when mailbox verification is not configured. Reserved `.invalid` test domains are excluded from prospect send-history results and the morning bounce warning.

Use `pnpm list:bounces` for the unresolved failed-address queue, or send `{"action":"bounces"}` to the authorized `/api/lists/import` endpoint. The queue includes rejected addresses, previous evidence, saved failure reports, and research outcomes. The endpoint also reports whether verification and broader research are configured. An external researcher should process this queue before generating new lists and submit substantiated candidates through `addresses-import`.

## Email footer

Initial outreach and follow-ups, including curated lists, include an Unsubscribe button and a matching plain-text URL. The URL is the same signed target used by the one-click unsubscribe mail header. GET displays a confirmation form; only POST changes contact preferences, preventing link scanners from silently unsubscribing recipients. A successful form submission displays confirmation. Existing address-wide suppression stops later outreach and sequences.

## Release

These changes are local until deployed. Verify the production provider keys before expecting replacement addresses to become eligible. Existing failures will enter the worker automatically after deployment; no research evidence needs to be promoted to verified by hand.
