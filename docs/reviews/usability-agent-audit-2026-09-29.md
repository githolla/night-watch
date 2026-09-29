# Night Watch usability and reliability audit

Date: September 29, 2026. Reviewed production source at commit 439f378.

## Original audit scope and decision

Three independent agents reviewed the composer/tour, delivery/follow-ups, and account/settings/list behavior. The primary reviewer cross-checked the major findings against the source. The production browser reached the sign-in page; no authenticated workflow or inbox test was performed. No prospect or test emails were sent. The original findings below describe that read-only review. The implementation status at the end records the subsequent fixes.

**Decision: not yet ready for an unattended handoff.** The recent initial-send protections are useful, but the same protections do not cover follow-ups. Draft persistence and signature settings have paths that can lose work.

## Fix before handoff

### 1. Autosave can replace newer writing

Evidence: `src/components/Desk.tsx:354`, `:838`; `src/app/api/cards/[id]/route.ts:53`.

Reproduction: edit a subject, tab into the message, then type while the subject save is slow. Its response contains the entire older card and merges that old body over the new typing. Saves are not serialized or revision-checked. Two people editing the same record can silently overwrite each other. Owner/batch links also unload the page without waiting for an in-progress blur save.

Change: serialize writes per card, merge only acknowledged fields whose local revision still matches, enforce server revision checks, and show Unsaved / Saving / Saved / Save failed. Flush saves before owner/batch navigation. Provide a conflict view rather than silently choosing the last writer.

Acceptance: delay and reorder subject/body save responses; newer text must remain. Navigate during a save and reopen. Simultaneous Josh/Suuchi edits must produce an explicit conflict.

### 2. Follow-ups can duplicate a delivered email

Evidence: `src/app/api/cron/cadences/route.ts:69–82`; `src/app/api/cadence-steps/[id]/send-now/route.ts:79–84`.

The scheduler reclaims stale pending steps after 15 minutes. If Gmail accepted but the later database status write failed, the pending step can be sent again. These paths lack the durable reservation now protecting initial emails. Follow-up daily-count reads also ignore failures and substitute zero. Separate contacts can race for the last available daily slot.

Change: use a common delivery service for initial and follow-up emails, with per-message reservations, mailbox quota reservations, explicit delivery outcomes, and checked post-send writes. Never expire an uncertain delivery into another send.

Acceptance: crash after Gmail acceptance; fail history/status writes; race cron against Send now and race different contacts at the daily limit. At most one request per message may reach Gmail, and the quota must hold.

### 3. Follow-up sends bypass list-owner enforcement

Evidence: `src/app/api/cadence-steps/[id]/send-now/route.ts:26–52`, `:85`; `src/components/Desk.tsx:1360`.

The route authenticates a user but sends using the cadence owner's mailbox without checking that the two match. The desk also exposes the action without the initial-email owner restriction. The returned sentBy field can identify the viewer instead of the actual sender.

Change: enforce the owner rule server-side and reflect it in the UI. Shared viewing/editing should remain distinct from permission to send.

Acceptance: Josh viewing Suuchi's follow-up cannot send it from her account, including a direct API request. Suuchi can send her own.

### 4. Follow-ups needing help can disappear

Evidence: `src/lib/followups.ts:76`; `src/app/api/cron/cadences/route.ts:49`; `src/app/followups/page.tsx:37`; `src/app/api/cadence-steps/[id]/send-now/route.ts:43`.

Automatic emails moved to ready because an address is unverified or Gmail is disconnected do not appear in the Follow-ups page's review-only query. Send now rejects ready steps. This is particularly relevant to the app's inferred addresses.

Change: one actionable follow-up queue covering scheduled, ready for review, failed, delivery unknown, and sent, with a reason and next action on each item.

Acceptance: disconnect Gmail or use an unverified recipient. The blocked follow-up remains visible with a working recovery path.

### 5. A settings read failure can erase a signature

Evidence: `src/app/settings/page.tsx:30–52`; `src/app/api/settings/sender/route.ts:37`.

The settings page discards the sender-profile query error and substitutes empty values. Saving another setting from that empty form can overwrite the stored signature.

Change: show a retryable load failure and prevent saving until settings have loaded. Distinguish a missing profile from a failed read.

Acceptance: force the read to fail. No empty editable form or destructive save should be possible; the existing footer must survive.

## Next usability fixes

- **Recover from failed actions:** contact switching (`Desk.tsx:430`) and Mark as already sent (`:463`) can leave pending flags set after network/JSON failure. Use catch/finally and a visible retry action.
- **Recover unknown sends safely:** the new initial-email reservation prevents duplicates but has no user-facing reconciliation workflow. Show a Needs confirmation state with recipient, subject, sender and attempt time. Check Gmail before an explicit recovery; do not automatically expire the reservation.
- **Make connection status consistent:** `Connections.tsx:58–73` still treats a stored row as a green working connection. Only admins get the newer live check. Members also see another owner's reconnect button even though the server silently redirects it to their own seat. Show each person's live status, and make other-seat controls read-only.
- **Test the settings shown:** `SenderProfileForm.tsx:49–54` tests saved settings, even when the visible signature has unsaved edits or Save is still running. Track dirty state and offer Save and test. Reset the Saved label after editing.
- **Keep meeting-time insertion sendable:** `Desk.tsx:801` appends another question after an existing CTA, violating the one-question validator. Replace the CTA instead.
- **Make bulk editing reviewable:** `Desk.tsx:756–776` immediately overwrites edited/approved unsent drafts. Show owner, batch, affected count, a preview and an undo action. Label the action Apply to this batch.
- **Show validation before failure:** provide subject/message character counts and inline limits before blur/save/send rejects the copy.
- **Identify exactly what was tested:** self-test success survives variant changes and refers to the version shown now. Display the tested subject, version, sender and time; mark it stale after edits.

## Follow-up quality and reply handling

- Follow-up templates (`src/lib/followups.ts:17–30`) retain the old hiring-replacement pitch and generic copy. They should match the actual company workflow and chosen initial version. LinkedIn templates retain prohibited long dashes; email transport normalizes those characters.
- Reply monitoring (`src/app/api/cron/replies/route.ts:40`) always takes the oldest 300 unreplied touches. Without a cursor/last-checked rotation, newer conversations can be starved. Deduplicate by thread before limiting and rotate checks.
- Reply and cadence jobs both run every 15 minutes. The cadence checks stored reply state rather than the current Gmail thread, so a reply can arrive before a scheduled bump and still receive that bump. Recheck the thread before automatic sending and stop when that check is unavailable.

## Design and performance improvements

The best next improvement is predictable state, not a wholesale visual redesign. Keep one composer with a clear sequence: choose version, edit, preview, test, send. Always show list owner, actual sender, recipient, save state and delivery state near the actions.

The reach-out page still performs preparation/backfill writes during page rendering and waits for the broad overview query bundle (`src/app/outreach/page.tsx:86–128`, `:178`). Move preparation into an explicit/background operation; render saved drafts first and load overview metrics separately. This is a code-based performance concern, not a measured authenticated-page latency result.

The tour should explicitly explain both owners and both batches. Its bulk-edit steps can target controls hidden in Preview mode. Open the required editor before advancing and offer a visible exit/restart. Research guidance should be reachable. Treat keyboard navigation, small-screen layouts, and focus behavior as live acceptance checks once signed in.

## Recommended implementation order

1. Draft/setting preservation and stuck-action recovery.
2. Shared send protections and owner enforcement for follow-ups.
3. Visible follow-up and uncertain-send recovery states.
4. Consistent connection status and Save-and-test behavior.
5. Bulk editing, meeting-time insertion, tour and page-loading improvements.

The prior 334 passing tests do not establish coverage of these newly identified paths. Add failure-oriented tests and then run a signed-in handoff walkthrough for both users. Do not certify actual inbox rendering from source inspection alone.


## Implementation update

The audited code paths have now been repaired:

- Serialized, revision-checked draft saves preserve newer typing, show save failures, guard navigation, and reject cross-session conflicts. Sending freezes edits and waits for the current save.
- Initial sends and follow-ups reserve delivery and daily mailbox capacity. Unknown outcomes retain their reservation. Follow-ups enforce owner permissions and check the live thread for replies before sending.
- Delivery recovery reconciles Gmail Sent with history and cadence records without resending. Releasing an unresolved reservation requires an explicit check and confirmation.
- Follow-ups include ready and failed items with recovery actions. Reply polling rotates across conversations. Generated follow-up copy no longer uses the old hiring-replacement pitch.
- Settings read failures no longer expose an empty editable signature. Save-and-test uses saved current settings, locks pending controls, and distinguishes confirmed delivery from uncertain outcomes. Members receive a live check of their own mailbox.
- Bulk edits have confirmation and undo; meeting times replace the CTA; character limits and content-specific test state are visible. Contact-loading failures expose Retry.
- The tour opens required controls and covers owner/batch selection. Reach-out rendering no longer performs preparation writes or waits on hidden overview metrics.
- Scheduled introductions share the manual initial-send reservation, validate sender identity, and retain cadence context for recovery. Re-enrollment preserves existing steps and returns a conflict instead of deleting delivery history.

Validation: 363 passing automated tests, ESLint, production build, and synthetic local composer checks. No prospect or test messages were sent during this work. The available production browser stopped at sign-in, so actual Josh/Suuchi mailbox delivery and inbox rendering remain unverified by this audit. Passing source-level checks is not an inbox-rendering certification.
