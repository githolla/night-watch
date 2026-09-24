# LinkedIn reply review

Reviewed September 24, 2026. Scope: all 112 saved LinkedIn drafts for 28 contacts at 25 accounts in `data/linkedin-variants.json`. These are cold direct messages or InMail, not connection-request notes. All 112 message bodies were revised. Contact identities, variant IDs, labels and subject schema remain unchanged.

## What the review corrected

The previous set used the same proof CTA 28 times and the same generic Personal CTA 20 times. Personal drafts often asked a diagnostic question and then a second, generic question. Business drafts all began with "A thought" and reused a generic explanation. Several asked a stranger to choose a pilot or design a workflow before establishing a reason to engage.

The revisions introduce Nine-67 in plain language, name a relevant piece of work, and leave one answerable question. The asks are either a specific, low-effort assessment of relevance or permission to send an outline of the proposed approach. They do not imply that a custom prospect demo already exists. Receiving permission to send an outline still requires the sender to prepare and fulfill that offer.

The four versions test different approaches:

- **Personal:** a reason for contacting this person and a narrow question about the work.
- **Business idea:** a proposed first build and the review or measurement that makes it practical.
- **With proof:** one accurately scoped example, its relevance, and a small next step.
- **Wildcard:** a more memorable description of a concrete job for AI, followed by a grounded explanation.

Twenty deployed applications appear in eight messages, all in the proof version. No invented savings, staffing availability, promised start dates, or industry outcomes were added. Existing-system and human-approval language stays where relevant; AI is not promised authority over scientific validation, engineering, pricing or treatment decisions.

## Evidence and specificity

The account scope and company facts came from `data/revenue-focus.json`. Proof boundaries came from `src/lib/outreach-proof.ts` and the public case-study record at https://www.nine-67.com/case-study. The 20-application engagement is owner supplied and has no supplied timeline or measured ROI.

The reporting assistant is described as built and ready, not deployed. The one-month production claim is limited to the professional-services account-risk example. Sector analogies are explicitly prospective. Kirk Maxey's scientific-validation point is attributed to him; Aaron Curtis's onboarding research is attributed to him in both Alta contacts' messages. Evans' TMS is not described as newly implemented. Braman's acquisition is not presumed to remain an active integration problem.

Same-company contacts have different angles: Cayman CEO evidence retrieval and scientific validation versus innovation leader project-review preparation; Alta CEO acting on early concerns versus Aaron's existing research and FieldRoutes process; Chrysan CFO supplier-to-order impact versus CEO cross-team project prioritization.

## Mechanical review

- 28 contacts, four populated versions each: 112 messages.
- Message length: 39 to 57 words, average 48.2.
- Exactly one question mark per message, at the end.
- Every message identifies Nine-67.
- No em or en dashes in message or subject.
- No fixed Josh identity; first-person introductions use `{sender}`.
- No new runtime generation or UI changes.

## Limits

This is an editorial and evidence review, not proof of an optimal response rate. Company research supports relevance, not confirmed need, budget or buying intent. Nothing in this review verifies the recipient's LinkedIn account or current availability. Messages require a real send, delivery and response history to evaluate performance. Use reply and positive-reply results, not opens alone, and avoid treating this small, nonrandomized cohort as a conclusive variant test.
