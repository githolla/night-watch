# Email reply review

Reviewed 112 saved email versions and 28 current/default contact emails across all 25 accounts and 28 named contacts. Revised every message. Four stable version IDs and labels are preserved.

## What changed

- Personal versions lead with a specific operating situation rather than a vague interest in exploring AI. The closing question tests relevance without asking the executive to specify a software project.
- Business idea versions name a proposed workflow and a measurement. The first reply no longer requires choosing a category, supplying a document, or assembling colleagues.
- Proof versions keep the source engagement distinct from the proposed use at the recipient. Most now establish recipient context before proof. The 20-application fact remains selective.
- Wildcards keep an unconventional but relevant angle without jokes about the recipient's competence. English Gardens now proposes preparing buyer options rather than suggesting its buyers have forgotten to check their own stock.
- Requests for hypothetical sector artifacts now use sketches/proposed examples. No cold email demands a redacted internal document as the price of a reply.
- Removed stale relative timing for Evans, unsupported small-team claims for Chrysan, and an unsubstantiated growth assertion for Native.
- Removed an orphaned opening from Braman and false personal-memory phrasing from Alta. Aaron's public findings remain attributed. Acquisition references do not claim an integration is still underway.
- Nine-67 is introduced in plain language. Saved messages are 60–83 words; current messages retain the required AI-first, forward-deployed engineer, custom software and reframe language.

## Evidence and limits

Company facts and recipient roles were checked against the local `data/revenue-focus.json` research records. Revenue, identity, and contact-address evidence were not changed.

Proof follows `src/lib/outreach-proof.ts` and the official case studies at https://www.nine-67.com/case-study (parent independently rechecked during this review). The account-health deployment's one-month timeline belongs to the professional-services client, not these prospects. Client reporting is built/ready, not claimed deployed. Proposal tooling is described as built. The 20 deployed applications and deployment components remain separate owner-supplied evidence.

These are editorial improvements, not a demonstrated optimal sequence. No reply-rate result, prospect pain, budget, buying intent, sector-specific deployment, or delivery commitment is invented. Published contact addresses are not thereby confirmed deliverable.

## Verification

- 112 saved messages retain the 28 identities and four version IDs/labels.
- Each ends in one CTA question, with no em/en dashes or fixed sender name.
- Saved sender interpolation remains intact; current messages use sender-neutral introductions.
- `outreach-variants.test.ts` and `revenue-focus.test.ts`: 8 tests passed, including current-draft quality checks and sender rendering.
- No messages sent. No UI or runtime AI changes made by this reviewer.

Integration: top-level account subject/message aliases now match the primary contact. The existing refresh process updates eligible untouched drafts and preserves edited, approved and sent drafts. A final editor changed proof CTAs to offer the relevant actual case-study example or an outline of delivered work, keeping them distinct from the Business idea sketches.
