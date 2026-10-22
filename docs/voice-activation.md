# Nightwatch voice activation

Implemented: authenticated Vapi calendar tools backed by Suuchi's existing Nightwatch Google connection. The Google account must be operations@nine-67.com. Meetings are 30 minutes with 15-minute buffers. Preferred hours follow America/New_York, including daylight saving time. Thursday 3pm to 4pm is protected. A prospect can explicitly request other hours or weekends; calendar conflicts and pickup remain protected.

The availability tool proposes up to eight slots. Booking confirms consent, rechecks live availability with buffers, then creates an invitation with a Google Meet link. Repeated requests for the same call, start and attendee reuse the event. Simultaneous independent bookings still depend on Google's calendar behavior; free/busy and event creation are separate operations.

## Connect

1. Save VAPI_API_KEY, VAPI_ASSISTANT_ID and a random VAPI_WEBHOOK_SECRET in Vercel Production, then deploy. A local private API key is only needed for the local setup script.
2. Use a dedicated assistant with its model and voice selected. Remove native calendar tools so they cannot bypass these scheduling rules. The script refuses unrelated saved tools, function callbacks and existing external server integrations rather than silently breaking them.
3. Preview with `node --env-file=.env.local --experimental-strip-types scripts/setup-voice.ts`. Add `--apply` to update the existing assistant's system instructions and calendar tools. No calls are placed and no phone number is reassigned.
4. The setup payload includes a transfer tool to Josh at +17177255050. Transfer only with the prospect's agreement. The authenticated POST /api/cron/voice endpoint supports preview and configure operations; configure also assigns the imported number +12015814309. Both operations require the explicit assistant and phone-number IDs, and refuse an unexpected number or conflicting routing.

Production diagnostics use CRON_SECRET bearer authentication. GET returns assistant and phone summaries without credentials. POST calendar-check reads availability without creating events. POST test-call is restricted to Josh's number and uses explicit internal-test instructions; it cannot call a prospect. POST call-status only reads internal calls to Josh belonging to the configured assistant. POST transport-check checks imported Twilio authentication without returning credentials. No voice cron is scheduled, and the status endpoint never dispatches calls.

## Test before prospect calling

Call Josh at +17177255050 with clearly identified test context. Check AI disclosure, latency, interruption handling and accurate use of the actual email. Test a calendar booking using an agreed test attendee, confirm the invite and Meet link arrive, and remove the test event afterward. Verify Tuesday cutoff, Thursday pickup, weekends requiring an explicit request, calendar conflicts and 15-minute buffers. Test transfer from a different destination phone so Josh is not transferring back to his own active call.

## Remaining activation work

On October 21, 2026, the production Vapi key was verified. Existing assistant 5c23de70-09c0-47db-a265-8c88fc5c7cd7 was configured as Nine-67 | Suuchi, preserving its model and voice, and assigned to the imported number. A live Google free/busy check returned available slots from Suuchi's calendar. No invitations were created by that check.

One internal call to Josh was attempted: 01a15fb1-8a78-788a-ac26-2107c6f11503. Vapi accepted the request, then ended it before connection with call.start.error-get-transport. A successful conversation, invitation delivery and transfer have not been verified. Resolve the phone transport failure before retrying.

The call's endedMessage reports: "Account not authorized to call +17177255050" and points to Twilio Voice Geo Permissions. Enable United States low-risk calling in the Twilio account owning the imported number, save, then retry the internal test once. Vapi reports a cost of zero for the failed attempt. A direct Twilio credential check was unavailable because Vapi did not return usable credentials.

The latest October 21 retry, 01a16002-46be-7cc5-bede-8cbabd80289a, still returned the same authorization error after the Console permission checker displayed Enabled. Vapi's imported Twilio Account SID matches the account in Josh's dashboard. A conflicting save-error banner remains visible in the supplied screenshot; verify persistence after a full page refresh before making another test call. The transport diagnostic exposes the Account SID for this comparison but never returns the Auth Token.

Automated prospect dispatch, per-prospect Nightwatch context loading, opt-out callbacks and end-of-call outcome persistence are not implemented by this calendar integration. Do not enable a prospect calling campaign until those pieces and the internal tests are complete.

## Email follow-up v2 release

The October 22 playbook changes the initial offer to a **15-minute** workflow conversation with Suuchi, with the existing 15-minute calendar buffer. It also restores an explicit AI introduction. The earlier 30-minute configuration and Alex-only opening are superseded.

Apply `supabase/migrations/0035_voice_followup.sql` in Supabase before deploying and configuring this release. The migration creates server-only attempts, actions, slots, suppression and eligibility records. The local database suite is `bash scripts/test-voice-database.sh`; it requires PostgreSQL binaries and creates an isolated temporary database, never a production connection.

Production activation order:

1. Apply migration 0035.
2. Deploy this branch to Production.
3. Run authenticated `configure` against `/api/cron/voice`. It checks the audit table, reuses or creates the named Vapi structured output, attaches the tools and subscribes to end-of-call reports.
4. Run `followup-preview` to inspect a currently eligible Suuchi email. A sent subject is used only when recovered from the matching sent Gmail message. The current draft subject is never substituted. Unknown prospect timezone stays unknown and the spoken timing falls back to "recently".
5. Run `test-followup` with the selected task ID and a unique `attemptKey` UUID. The destination is always Josh's internal test number. The exact context and prompt version are saved before requesting the call. A repeated key or another active attempt prevents another dial. If the provider response is uncertain, the attempt is held instead of blindly retrying.
6. Review Calls & prep > AI follow-up activity. Use `reconcile-call` with the Vapi call ID to fetch late structured results for a known ended call. Old calls made before audit records existed are not authorized for contact tools.

Available tools:

| Tool | Actual behavior |
| --- | --- |
| `nightwatch_availability` | Reads the designated calendar and saves at most two expiring slot IDs, bound to the current call. |
| `nightwatch_book` | Accepts a bound slot and explicit confirmation. Rehearsals simulate booking. The pilot-only branch rechecks the calendar and uses a stable event key. A changed attendee address goes to human review. |
| `request_email_followup` | Saves a request for human review. It does not send an email. |
| `schedule_callback` | Saves an explicitly confirmed future callback time and IANA timezone. It does not start an automated callback. |
| `suppress_contact` | Uses a transaction to apply voice or all-outreach suppression. Rehearsals simulate it. Failures independently hold further voice and, for all-channel requests, automatic email outreach. |
| `request_human_followup` | Saves an actionable task. A live decline stops the current cadence; a wrong number holds voice until correction. |
| `transferCall`, `endCall` | Existing configured transfer and end-call tools. Internal calls to Josh cannot transfer back to the same number. |

External dialing remains disabled in code. `queue-refresh` only prepares Nightwatch queue records and reports holds. No cron or worker consumes that queue. A prospective pilot also needs a sourced IANA timezone and current eligibility approval in `voice_eligibility`. Dispatch must refresh context and use `voiceEligibility` immediately before any future dial; the queue's stored context is not permission to call. Follow-up delay is one to five business days, default one, calculated in the contact's timezone. The initial calling window is weekdays 9am to 5pm local. Queued attempts cancel when a reply, bounce, meeting status or opt-out is recorded.

This release does not silently change external calling authorization. Before building or enabling a prospect worker, finish an atomic queue-claim/lease, cancellation reconciliation with Vapi, an approved retry/attempt policy, and the phone test matrix below. The existing unique attempt key and active-contact index are safeguards, not a complete distributed dispatch worker.

Structured analysis is advisory. Calendar results establish bookings, suppression records establish suppression, and queued action records establish callback/email requests. Missing or conflicting analysis is flagged for review. Rehearsal bookings never create real invitations. Late results require explicit reconciliation; no periodic reconciliation worker is configured yet. Voicemail currently uses detection with silent termination, with no approved message. Phone testing must verify detection and interruption settings before a pilot.

### Phone acceptance matrix

Record expected behavior, observed behavior, root cause, change, version and retest result for each scenario. Source/data, prompt, tool, audio timing, transcription, workflow and model failures are distinct categories.

| Scenario | Expected behavior | Current validation |
| --- | --- | --- |
| Correct person; interested | Specific email reference, one relevant question, real booking path | Context and bound-slot unit tests; phone test pending |
| Busy | Stop pitch; ask once about callback or email | Prompt configured; phone test pending |
| Never saw email | One faithful sentence; no inbox search demand | Prompt configured; phone test pending |
| Cross-timezone send date | Backend-generated spoken timing | Unit tests pass |
| Missing sent timestamp | "Recently" for speech; backend holds unconfirmed sends | Unit tests pass |
| Missing sent email | Hold before dialing | Unit tests pass |
| Exact email question | Use immutable touch body and matching Gmail subject | Context tests; phone test pending |
| Wrong number or gatekeeper | No private email details, no pitch or automatic referral dialing | Prompt configured; phone test pending |
| Not interested | End politely; stop current sequence | Tool implementation; phone test pending |
| Stop calling | Voice suppression, leave email scope unchanged | Isolated SQL test passes; phone test pending |
| Remove me entirely | All-channel suppression and stop sequence | Isolated SQL test passes; phone test pending |
| Suppression endpoint fails | Independent hold and urgent review, no false success | Runtime failure test passes |
| AI or human preference | Honest answer; save human follow-up | Prompt configured; phone test pending |
| Price or security question | Approved facts or human escalation | Prompt configured; phone test pending |
| Book immediately | Skip additional discovery | Prompt configured; phone test pending |
| Ambiguous timezone | Ask; no assumed scheduling timezone | Schema and policy tests; phone test pending |
| Calendar unavailable | No invented slots or claimed booking | Calendar transport tests pass |
| Booking timeout or duplicate tool request | Hold or reuse result; no blind second invitation | Stable event and action tests pass |
| Existing meeting or queued reply | Cancel follow-up | Policy and SQL trigger tests pass |
| Long voicemail greeting; no beep; full mailbox | Silent termination, no false message confirmation | Configuration prepared; phone tests pending |
| Human interrupts | Stop promptly and answer first | Speaking settings prepared; phone test pending |
| Embedded instruction in source data | Treat it as reference, never authority | Prompt and context tests; adversarial phone test pending |

Score calls using identity 10, email accuracy 15, workflow relevance 15, concise conversation 15, listening 10, objections 10, tools/truthful confirmation 15, and accurate outcome 10. Automatic failures include ignoring opt-outs, pretending to be human, inventing email history/availability, unconfirmed bookings, cross-prospect disclosure, unapproved claims and a backend-ineligible call. Initial release target: all critical scenarios pass and average score at least 85. This target is not yet met or measured.

### Conversation regression: October 22 booking rehearsal

Call `01a1648f-b29d-7000-80e5-ee86d20ab2b1` ended with `exceeded-max-duration`, not the end-call tool. The 180-second internal override cut off Alex mid-confirmation. The transcript also showed fragmented email dictation and repeated invention of a dot and hyphen after corrections. This scenario failed acceptance.

Version `email-followup-v3` changes the internal limit to 600 seconds, applies LiveKit turn endpointing to configuration and call overrides, adds 2.5-second waits around email/address fragments, and suppresses automatic function-tool start fillers. It instructs Alex to discard rejected email guesses, collect local part and domain separately after a correction, escalate after two failed attempts, and wait for the caller after reporting a booking result. Tool results return the exact accepted attendee and a deterministic spoken spelling. External calls retain the existing five-minute cap.

Validation: email-spelling, timing configuration, tool-filler and internal-duration regressions are covered by automated tests. This is a candidate fix; a fresh phone test is still required for perceived fluidity, interruption behavior and the booking close. No new SQL migration is needed. Deploy and run `configure` before testing so the new timing also applies to the live assistant.

### Greeting and alternate voice candidate

Version `email-followup-v4` sets `firstMessageMode=assistant-waits-for-user` on the assistant and internal call overrides, and allows interruptions during the first message. Alex should wait for the recipient's greeting rather than speak as soon as the line connects. Phone verification is still required.

The authenticated configure action accepts `voiceChoice: "clara"` or `"sid"`. Clara is a natural American female Vapi V2 voice; Sid is a calm American male Vapi V2 voice. An omitted choice preserves the currently selected voice. The proposed next test uses Clara, pending the user's preference. Native Vapi voice settings are applied without changing calendar or outreach authorization. No new SQL is required.
