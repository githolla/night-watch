# Bounce research and proposed daily loop: October 13, 2026

Today's database snapshot contains 24 prospect bounce records: 14 for Josh and 10 for Suuchi. Two additional records belong to a sequence test and share real prospect thread IDs; exclude them from prospect counts. This is a count of recorded failures, not a bounce-rate calculation. Sends without a recorded bounce are not necessarily delivered.

All 24 affected prospect rows currently have `email_source: pattern`, `email_status: invalid`, and no Hunter result. Their source lists contain 23 inferred addresses and one directory-published, unverified address (Rogelio Maldonado). The inferred entries explicitly warn that the cited page does not establish the exact mailbox.

Read 14 original delivery notices in Josh's Gmail and two notices forwarded by Suuchi. The other eight prospect failures are confirmed as bounce records in Supabase, but their exact SMTP diagnostics were not accessible: the local Gmail token encryption configuration could not decrypt the connected mailbox credentials.

Across the 16 accessible notices: 13 show Exchange `550 5.4.1`, two show Gmail `550 5.1.1`, and one shows `550 5.7.133` for a group that restricts external senders. Microsoft documents the specific `550 5.4.1 Recipient address rejected: Access denied` response as directory-based rejection of an invalid recipient: [Microsoft troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/exchange/email-delivery/ndr/fix-error-code-550-5-4-1). The words "Message blocked" in Gmail do not by themselves establish a sender-reputation problem.

The app's website finder was run read-only against all 24 prospects. It read 111 pages and returned no replacement evidence. Broader search found three candidates on currently accessible pages and four historical leads. Published evidence establishes a lead to verify, not proof that the mailbox currently accepts outside email. No contact was changed, card reopened, or email sent during this review.

## Replacement candidates

| Person | Published candidate | Evidence | Next step |
|---|---|---|---|
| Justin Crocker | `jcrocker@earthtonescompanies.com` | [current company page](https://earthtonescompanies.com/team/justin-crocker/) | Confirm current identity and mailbox; keep held until verified |
| Kyle Selbach | `kyle@alluneedpest.com` | [current association page](https://flpma.org/fpma-executive-committee) | Confirm current identity and mailbox; keep held until verified |
| Greg Canning | `greg.canning@callecon.com` | [current company page; email domain differs from website](https://www.economyexterminators.com/greg-canning/) | Confirm current identity and mailbox; keep held until verified |
| Chase Mullin | `chase@mullinlandscape.com` | [historical association directory; publication date needs confirmation](https://www.lnla.org/assets/docs/Newsletters/263612_LNLA_Newsletter_v86_DIGITAL.pdf) | Confirm current identity and mailbox; keep held until verified |
| Lanny Allgood | `lallgood@cingohome.com` | [historical association directory (2022)](https://assets.noviams.com/novi-file-uploads/gpca/GPCD0022-dl-2d9e3f4a.pdf) | Confirm current identity and mailbox; keep held until verified |
| David Snodgrass | `davids@dennis7dees.com` | [historical correspondence published by the city; direct fetch unavailable during review (2024)](https://www.ci.cannon-beach.or.us/media/43556) | Confirm current identity and mailbox; keep held until verified |
| Keith Duncan Jr. | `jr@blackdiamondpestcontrol.com` | [historical association newsletter; too old to trust without fresh confirmation (2013)](https://extension.entm.purdue.edu/IPMA/newsletter/pdfs/IPMA_March_2013.pdf) | Confirm current identity and mailbox; keep held until verified |

Greg's alternate `callecon.com` domain is stated on his own company's leadership page. The current importer rejects it because it requires an address to end in the website domain. A different website domain is therefore not sufficient reason to discard a company-published personal address.

Chase's historical directory evidence uses `chase@`, while the failed guess was `cmullin@`. Lanny's directory uses `lallgood@`, while the failed guess was `lanny.allgood@`. These illustrate why a common company pattern cannot establish an executive's exact mailbox.

For Dupper, the company's own [about page](https://dupperlandscape.com/about-rh-dupper/) publishes a general mailbox on the legacy `rhdupper.com` domain. It is a domain-research lead, not Russ's personal address. For Chris Angelo, an older [self-authored article](https://www.linkedin.com/pulse/5-crucial-items-look-your-commercial-landscape-contract-chris-angelo) publishes an address on `staygreenlandscaping.biz`; it needs fresh confirmation and is not included as a ready replacement.

## Every affected prospect

| Seat | Person | Failed address | Research outcome |
|---|---|---|---|
| josh | Russ Dupper | `russ.dupper@dupperlandscape.com` | No substantiated replacement yet; keep in research queue |
| suuchi | Christy Webber | `christy.webber@christywebber.com` | Restricted group; find personal mailbox or use another channel |
| josh | Victor Romeiro | `victor.romeiro@xquisitelandscaping.com` | No substantiated replacement yet; keep in research queue |
| suuchi | Chase Mullin | `cmullin@mullinlandscape.com` | Published candidate above; verification pending |
| suuchi | Larry Thalmann | `larry.thalmann@chaletnursery.com` | No substantiated replacement yet; keep in research queue |
| suuchi | Chris Angelo | `chris.angelo@staygreen.com` | No substantiated replacement yet; keep in research queue |
| josh | Dan Waters | `dan.waters@creativeenvironments.com` | No substantiated replacement yet; keep in research queue |
| josh | Mark Forsythe | `mark.forsythe@mainscape.com` | No substantiated replacement yet; keep in research queue |
| josh | Lanny Allgood | `lanny.allgood@cingohome.com` | Published candidate above; verification pending |
| josh | Jared LaJaunie | `jared.lajaunie@lajaunies.com` | No substantiated replacement yet; keep in research queue |
| suuchi | Mark Tomko | `mark.tomko@valorlandscapeco.com` | No substantiated replacement yet; keep in research queue |
| josh | Gary Evans | `gary.evans@fastactionpestcontrol.com` | No substantiated replacement yet; keep in research queue |
| josh | Greg Canning | `greg.canning@economyexterminators.com` | Published candidate above; verification pending |
| suuchi | David Snodgrass | `david.snodgrass@dennis7dees.com` | Published candidate above; verification pending |
| josh | Mickey Nolen | `mickey.nolen@nozzlenolen.com` | No substantiated replacement yet; keep in research queue |
| suuchi | Justin Crocker | `justin.crocker@earthtonescompanies.com` | Published candidate above; verification pending |
| josh | Joe Jerome | `joe.jerome@meerkatpest.com` | No substantiated replacement yet; keep in research queue |
| josh | Lee Allen Whitmore | `lee.allen@qualitypestservices.net` | Failed address uses Lee Allen, omitting surname Whitmore; do not generate another guess |
| suuchi | Cheryl Balbinot | `cheryl.balbinot@aaalandscape.com` | No substantiated replacement yet; keep in research queue |
| suuchi | Phil Kelly | `phil.kelly@mchalelandscape.com` | No substantiated replacement yet; keep in research queue |
| josh | Kyle Selbach | `kyle.selbach@alluneedpest.com` | Published candidate above; verification pending |
| suuchi | Rogelio Maldonado | `rogelio@mnlsa.com` | No substantiated replacement yet; keep in research queue |
| josh | Andrew Wolfertz | `andrew.wolfertz@urbanexpro.com` | No substantiated replacement yet; keep in research queue |
| josh | Keith Duncan Jr. | `keith.duncan@blackdiamondpestcontrol.com` | Published candidate above; verification pending |

## Proposed daily loop

1. **Collect continuously.** Keep the existing 15-minute reply poll. Store the failed recipient from the delivery notice with its message ID, outbound touch, mailbox owner, SMTP status, diagnostic, and actual failure time. Do not infer the failed address from the person's mutable current address. Idempotency is by mailbox and Gmail bounce message ID.
2. **Exclude immediately.** An invalid mailbox stops its cadence and is excluded by normalized email across all contacts, lists, imports, and send paths. Preserve every failed address when a person is corrected. A policy-restricted group remains held for outside outreach. A temporary `4xx` failure belongs in a separate retry category. Do not suppress an entire company solely because one mailbox failed.
3. **Research before tomorrow's list is prepared.** Each evening, process new bounces first, then unresolved contacts. A new bounce bypasses the old seven-day site-search cooldown. Unresolved bounces receive one research attempt per day, with a bounded per-run budget and recorded sources, outcome, and next attempt. Keep the original rejected addresses in the researcher's input.
4. **Broaden evidence.** Search company leadership pages and linked individual biographies, industry associations, company-issued releases, and appropriate public business records. Add PDF text extraction and exact name-address association. Check primary-source ownership of alternate email domains. Record source publication date separately from the date the page was fetched. Broker format statistics and two colleagues' addresses generate candidates only.
5. **Verify separately.** Use a configured mailbox verifier and confirm current person/company identity. Store `published_unverified`, `pattern_candidate`, `mailbox_verified`, `catch_all`, `unknown`, `invalid`, and `policy_restricted` as distinct evidence or deliverability states. DNS/MX only establishes domain mail capability. Publication, format inference, a verifier timeout, and a catch-all domain do not establish a verified personal mailbox.
6. **Release deliberately.** Recommended automatic-send policy: only a verified personal mailbox with no negative history is eligible. Research must save replacements while leaving bounced cards held; reopening a card currently can trigger an automatic resend. Keep unknown and catch-all results held for review or choose another channel. Gmail acceptance and one hour without a bounce are not proof of delivery. A genuine reply is stronger delivery evidence.
7. **Review each morning.** Show unique prospect sends, new failures by SMTP category, failed source/format, candidates found, mailbox verifications, unresolved contacts, and backlog age for each seat. Exclude test records and duplicated threads. Evaluate rates by the cohort of sent addresses, because bounces can arrive on later days. Keep watching corrected addresses and feed new failures back into the same queue.

## Existing code gaps to address

- `src/lib/bulk-sendable.ts`: `sendableAddress` allows unverified guesses and is used by morning sends and bulk sending plans. `bulkSendable` also treats a pattern marked `likely` as ready.
- `src/lib/recipient-verification.ts`: an address is considered delivered after only one hour without a bounce. `markBounced` retains only one `bouncedEmail`.
- `src/lib/address-sweep.ts`: every site search has a seven-day cooldown, including freshly bounced contacts that were searched before the bounce.
- `src/lib/address-finder.ts`: fixed-path discovery can miss linked person pages, and extraction restricts addresses to the website domain. The sweep missed Justin's own individual team page and Greg's alternate company mail domain.
- `src/lib/nightly-list-builder.ts`: published evidence is promoted to `verified` without a mailbox verification; importing a correction replaces `email_check` and reopens sent cards. This can discard negative address history and permit another unverified automatic send.
- `src/lib/bounce.ts`: bounce updates match a Gmail thread without person and sender scoping. Today's two sequence-test records share real prospect thread IDs. The failing recipient should be matched from the notice before recording a person's address as bad.
- `docs/DEPLOYMENT.md`: it describes a bounce brake that pauses sending, while current morning-send code/tests explicitly continue sending and only warn. Align the documentation and behavior as part of the sending-policy decision.

## Status at the research cutoff

The daily loop above is a proposal, not an activated automation. Production sending rules and live contacts were not changed. Candidate JSON in this directory is research evidence and is not an address-import payload. The policy question was subsequently approved. The implementation is documented in [Bounce research loop](../BOUNCE_RESEARCH.md).

Baseline checks on the checked-out application passed: 741 tests, TypeScript typecheck, and ESLint. These checks establish the current repository baseline; they do not validate the accuracy of any candidate mailbox.
