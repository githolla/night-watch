# Night Watch second-pass review

Reviewed September 29, 2026, against release 908346b. Scope: sequence enrollment, follow-up execution/UI, reply monitoring, calendar booking, manual activity logging, test emails, and analytics. This is a source review with isolated mocked probes, not a signed-in production walkthrough. No email or calendar invitations were sent, and no application code was changed.

## Findings, in priority order

### P1: A declined meeting time can be selected for automatic booking

Evidence: `src/lib/calendar.ts:65-82`; `src/app/api/cron/replies/route.ts:17-28,72`.

The matcher scores weekday/date/time mentions without understanding acceptance or negation. An isolated probe supplied two slots and the reply “Happy to talk, but Tuesday at 10am does not work. Could we find another time?” It returned Tuesday at 10am. If the general reply classifier labels that reply positive, autoBook creates an invitation for the explicitly declined time. The probe confirms the matcher defect, not the classifier's output.

Fix: require explicit acceptance of a single future slot, exclude quoted mail and negated/ambiguous choices, recheck availability, and use a stable booking key. Ambiguous replies should offer the sender a review action. Concurrent cron runs currently also have no atomic booking claim; the saved invite_link is only a read-before-write guard.

Acceptance: rejected, quoted, tentative, multiple-choice, expired and already-busy slots never create an invite. Concurrent processing of one accepted reply creates one event.

### P1: Calendar errors can look like an empty calendar

Evidence: `src/lib/calendar.ts:35-42`.

The code checks HTTP status but not the calendar-level errors inside a successful free/busy response. A mocked HTTP-200 response containing `calendars.primary.errors` and no busy array produced three proposed slots. Missing primary data similarly falls back to an empty busy list.

Fix: require a valid primary-calendar result, reject calendar-level errors, and show “Could not check availability” instead of suggesting times.

Acceptance: per-calendar errors and missing/malformed results produce zero suggested slots and a recoverable error.

### P1: Later replies can disappear after an out-of-office response

Evidence: `src/app/api/cron/replies/route.ts:43,69`.

Polling selects only touches whose reply_at is null, then stamps all open touches on the thread on the first response. After an OOO response, a later real reply will not be selected unless a new unreplied touch exists. A positive conversation can likewise have subsequent messages ignored.

Fix: track a per-thread last-processed Gmail message ID independently of the first reply timestamp. Continue monitoring active conversations and make each inbound message idempotent. Handle OOO separately from a human response.

Acceptance: initial email -> OOO -> real human reply updates the conversation and alerts the sender once for each relevant event.

### P1: Partial reply processing can silently lose updates

Evidence: `src/app/api/cron/replies/route.ts:69-81`.

Database update results are not checked, and per-thread exceptions are swallowed. If reply_at is saved but the card/cadence update or notification fails, the next run excludes that touch and does not repair the missing operation. Conversely, a failed touch update can cause duplicate notifications on the next run. Returning only a replies count hides these failures.

Fix: record an inbound event, process status/cadence changes reliably, and deliver notifications through a retryable outbox. Expose checked/processed/failed counts and last successful poll per mailbox. Preserve meeting status when processing subsequent conversation updates.

Acceptance: independently fail each database write and notification; retries converge to one correct conversation state and one notification.

### P2: Sequence enrollment can leave an unrecoverable empty sequence

Evidence: `src/app/api/cards/[id]/cadence/route.ts:18-23`.

The parent cadence is inserted before scheduling and step insertion. Invalid time-zone input or a failed step insert leaves the parent behind. Retrying then returns cadence_exists. The new duplicate guard correctly preserves existing history, but needs a repair path for incomplete enrollment.

Fix: validate/compute the entire sequence before writing, then create parent and children transactionally or with an explicit initializing state that supports safe completion. Never delete an existing sent or held sequence to recover.

Acceptance: scheduling and child-write failures leave either no sequence or a resumable incomplete sequence; retry creates exactly one complete set of steps.

### P2: Manual “already sent” can duplicate History

Evidence: `src/app/api/cadence-steps/[id]/route.ts:25-38`; `src/lib/manual-outreach.ts:46-55`.

Two requests can both read an unsent step and insert independent touches. If the touch insert succeeds but closing the step fails, a retry inserts another touch. This duplicates records rather than sending another email, but corrupts activity history and can distort reporting. The route also does not inspect a held transport claim before recording manual completion.

Fix: use a deterministic per-step manual action ID and an atomic state transition. Held delivery should go through reconciliation. Skip must conditionally update state so it cannot overwrite a concurrent sent transition.

Acceptance: double-click, two tabs, interrupted status write, and skip/send races preserve one truthful activity record.

### P2: Old completed follow-ups can crowd current work out of the page

Evidence: `src/app/followups/page.tsx:39-44`.

The same oldest-first query includes sent and actionable steps, capped at 500. Once enough historical rows accumulate, recent pending/failed work falls outside the result. Paused/stopped cadence rows can appear as due but have disabled actions without an explicit cadence-state explanation.

Fix: paginate actionable work separately from sent history; add owner, state, and due-date filters. Explain paused/stopped status beside disabled actions. Keep completed history lazy-loaded.

Acceptance: seed more than 500 historical sent steps and one new failed step; the failed step remains visible at the top of actionable work.

### P2: Follow-up actions can leave stale buttons and counts

Evidence: `src/components/FollowupsBoard.tsx:49-72,111-114`.

A delivery-unknown response only changes notice text; the row retains its prior claimed=false state and send button. A reply-found response removes only the clicked row even though the entire sequence stopped. The server blocks unsafe sends, but the UI invites attempts it cannot fulfill. A single busy ID also loses track of one request if another row's action starts before it completes.

Fix: refresh/reconcile the affected sequence after every action, immediately show delivery unknown as a row state with Check delivery, and track pending actions per row. Keep due counts derived from current server state.

Acceptance: ambiguous transport, reply-found, and simultaneous different-row actions all leave accurate controls without a manual reload.

## Product improvements after the defects

1. One compact readiness strip: list owner, sending mailbox, recipient verification, saved state, and the specific next action. Keep this visible in edit, preview, and test modes.
2. A daily work queue: replies needing action, delivery checks, due follow-ups, then untouched prospects. Show Josh/Suuchi and first/next batch as independent filters, with progress per batch.
3. Separate “Gmail accepted” from “arrived in inbox.” A self-test confirms transport, not final inbox rendering. Preserve the tested sender, subject, version and time in a small test history.
4. Analytics should emphasize human replies, positive replies, meetings and verified deliveries. Show sample sizes beside comparisons and keep test/manual/Gmail activity visibly distinct; a small sample is not proof of a winning version.
5. Add an operational health panel for reply polling, pending recoveries and sequence preparation, not just OAuth connectivity. A connected mailbox can still have a failed background job.
6. Keep the existing three-version composer. Improve state clarity and responsive/keyboard behavior through a signed-in walkthrough rather than another broad redesign.

## Validation gaps and recommended next implementation order

The existing calendar tests cover positive matches and weak cues, but not negation, expired slots or calendar-level API errors. The prior 363 passing tests therefore do not cover the two reproduced failures above.

Implement calendar correctness and durable reply processing first; then atomic enrollment/manual logging; then actionable queue pagination and UI reconciliation. Add failure-oriented tests for each reproduction rather than relying only on happy-path mocks.

A signed-in walkthrough is still required for Josh and Suuchi across desktop and a narrow viewport: switch owner/batch, edit, choose version, preview signature, test to self, inspect the actual inbox, and return to the correct list. This review does not certify those live behaviors.


## Fix implementation and regression results

Implemented the eight findings after the review:

- Calendar matching rejects negative, uncertain, quoted, and expired choices. Calendar-level errors fail closed; booking rechecks availability and reuses a deterministic event ID on retry.
- Reply polling revisits conversations after OOO replies. Each inbound Gmail message has durable phase checkpoints and a processing lease. Historical replies are baselined without replaying old notifications. Status writes are checked; meeting/pipeline stages are preserved. Notification failures retry, and booking issues are visible under Delivery recovery.
- Cadence creation saves a draft setup and its intended steps before activation. Incomplete setups resume using the saved payload. Existing steps are never deleted, and legacy empty active parents can be repaired.
- Manual completion claims the step and uses a deterministic history ID. Transport-held steps cannot be manually skipped/completed. Partial manual records can finish without another touch.
- Follow-ups separate actionable work, paused/stopped sequences, and paginated sent history, with owner filters. Refreshes reconcile state while per-row pending actions remain tracked.
- Adjacent fixes: the scheduler filters active sequences before limiting results; enrollment cannot demote an already-sent card; calendar/Gmail thread requests have bounded waits.

Verification: 386 automated tests passed, including calendar transport retries, OOO then human reply, concurrent processing, interrupted checkpoints, incomplete enrollment, concurrent manual completion, and held-transport guards. Local synthetic browser checks confirmed follow-up state labels and guarded actions. Lint and production build are checked before deployment. No real email or calendar invitation was sent during testing. Live signed-in workspace/inbox acceptance is still pending.

API references used for stable external identifiers: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert and https://docs.slack.dev/reference/methods/chat.postMessage/. External notification retry deduplication is best-effort; the application does not claim universal exactly-once delivery across external services.
