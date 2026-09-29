# Suuchi handoff review · September 29, 2026

## Decision
Not yet signed off end to end. Code/data checks pass, but the live review browser is at login. Suuchi's connected mailbox, saved signature and inbox receipt have not been verified. No prospect or self-test emails were sent during this review.

## Verified locally
- 100 companies across both owners and separate first/next batches; 100 contacts with address values, 300 email versions and 300 LinkedIn versions. No blank versions, unresolved sender placeholders or first-touch validation failures. Address presence does not establish deliverability; inferred/unverified addresses retain that status.
- 334 tests pass; lint and production build pass.
- Owner identity is taken from the selected list for authored drafts; prospect sending requires the owner to sign in. Self-tests address only the signed-in mailbox and omit prospect recipients and saved CCs.
- Archive restoration checks shortlist membership, company/contact restrictions and recorded outreach. Existing sent/dismissed/restricted cards are not automatically reopened.
- Recovery of an existing draft no longer falls through to an empty PATCH. A route-level test exercises this with the saved copy preserved.
- A successful Gmail self-test is still reported as sent if the subsequent history read fails. A route-level test simulates this failure without sending mail.
- Save failures use non-blocking notices and release busy state; uploaded footer is composed separately from pitch validation.

## Remaining live acceptance checks
1. Sign in as Suuchi and confirm the connected Gmail address and saved uploaded signature under Settings.
2. Open both batches; switch to Josh and back. Confirm selected owner, batch and three versions persist correctly.
3. On an unsent Suuchi draft, edit and save a small change, reload, and verify persistence. Restore the original wording after the test.
4. With explicit authorization, send one self-test. Confirm inbox and Sent folder receipt, Suuchi's identity and footer rendering. Check that no prospect touch or follow-up was created.
5. A prospect send remains untested. Only send when the operator explicitly chooses a real recipient; verify its History/version attribution and follow-up afterwards.

## Review limits
Unit and mocked route tests do not establish production database state, Gmail authorization, inbox delivery, or signature rendering in a real mailbox. The initial-email route now uses an atomic snapshot reservation across tabs; see the delivery follow-up below.

## Delivery review follow-up

The initial-email send route now reserves a deterministic message snapshot ID per card and recipient before contacting Gmail. PostgreSQL's existing primary-key constraint arbitrates concurrent requests across tabs and instances. This reuses the deployed immutable snapshot schema without a migration. A confirmed rejection releases the reservation; confirmed or uncertain delivery keeps it, even if later history writes fail. Reservations do not expire automatically: an uncertain send requires investigation in Gmail before any manual recovery, rather than a timed retry that could duplicate delivery.

The Gmail transport classifies network interruption, timeout, server errors, and missing/malformed delivery receipts as unknown delivery. The desk preserves that distinction instead of prefixing those outcomes with “Not sent.” Self-test errors also distinguish unknown delivery. Daily initial-email counts and self-test limit counts now fail closed when unavailable.

Verification: 334 automated tests passed, including concurrent snapshot reservation, uncertain delivery followed by retry, confirmed delivery with failed history writes, definite rejection, and unavailable send counts. Production build passed. These checks use mocked Gmail transport and do not certify Suuchi's live inbox or uploaded footer.
