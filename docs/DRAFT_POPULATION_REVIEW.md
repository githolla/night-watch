# Draft population review

Reviewed September 24, 2026 with independent coverage, application wiring and sender reviews.

## Coverage

The authored dataset contains 25 companies and 28 named contacts, with 28 default emails, 112 saved email versions and 112 saved LinkedIn versions. Each saved version is matched by company domain and recipient name. Coverage checks found no missing or cross-company versions. These checks establish local dataset coverage, not live database population or measured reply performance.

## Fixes

- Background draft refresh is keyed to the authored dataset content rather than a fixed historical marker, so a later copy revision triggers a new refresh.
- Untouched new cards with blank email bodies display the correct contact's authored default. Blank edited, approved and sent cards remain protected.
- Authored email and LinkedIn introductions render for the signed-in sender. Send and self-test endpoints independently enforce the same rule. Custom prose is preserved; an explicit conflicting Josh/Suuchi introduction blocks sending and appears as a warning in the composer.
- Authored cohort drafts that fail quality checks stop with an actionable error rather than invoking an AI rewrite.
- Existing sent history and manually edited prose remain preserved. Choosing a newly reviewed saved version is still explicit.

## Remaining limits

13 contacts have no recipient address on file. The other 15 addresses are published/unverified, not independently verified mailboxes. No emails were sent during this review. Reply improvement requires observed recipient replies; editorial review cannot establish it.

The reviewed copy commits and these wiring changes are local. Production population remains unverified because automatic approval review previously rejected the push. Concurrent edits between separate browser sessions are not covered by the saved-version picker’s local edit guard; background repair retains its existing database compare-and-swap protection.

## Validation

269 tests pass, including exact-contact default fallback, protected statuses, all saved sender variants, both sender directions and custom-edit conflict handling. Production build and scoped lint checked separately.
