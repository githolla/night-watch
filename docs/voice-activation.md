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
