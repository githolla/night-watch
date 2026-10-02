# Manual scoring rubric

`score = strength + person fit + recency + path`

A score of 60 or more creates an actionable card (`CARD_THRESHOLD`). A card at 75 or more is shown as priority (`PRIORITY_THRESHOLD`). An open card is archived once recency decay takes it below 45 (`ARCHIVE_THRESHOLD`); the gap between 60 and 45 keeps a card on the desk for a few days after it stops being fresh instead of dropping it the morning after. All three live in `src/lib/scoring.ts` and are imported everywhere they are displayed.

## Signal strength (maximum 40)

| Type | Base |
|---|---:|
| job cluster | 40 |
| executive post about AI, automation, efficiency, or scaling | 35 |
| new CEO, COO, CIO, VP Ops, or Head of Data | 30 |
| target job post | 25 |
| funding, acquisition, or new market | 20 |
| reachable event speaker or attendee | 20 |
| stack change | 15 |
| other | 10 maximum |

Job-post modifiers: +5 if open at least 30 days; +5 if reposted; +5 if maximum salary is at least $120,000. Strength remains capped at 40.

## Person fit

- Owner: 30
- Influencer: 20
- Adjacent: 10
- Unknown: 0; treat as a find-the-person task, not a send

## Recency

- Today or yesterday: 20
- Subtract 3 points for each later day
- At zero, archive unless a new signal arrives

## Path

- First-degree introduction available: 10
- Second-degree path through the team: 6
- Past CRM contact: 6
- Cold: 0

## Target job families

Applied AI for internal operations (an internal assistant, not an AI product), automation and process, data and reporting, systems/integration, CRM administration, and the analyst seats in RevOps and operations. Coordination seats (dispatch, scheduling, estimating, quoting, billing, order entry, purchasing, office administration) count for the nightly AI-fit score. These are the hires where Nine-67 builds the system instead. Sales reps, support desks and leadership hires do not qualify; the one exception is a leader hired to build AI or automation, which counts as a mandate. Building AI or ML as a product (ML engineers, data or applied scientists, computer vision, NLP), software and data engineering, plant and field engineering, technicians, installers and operators do not qualify either (`NOT_TARGET_ROLES` in `src/lib/agents.ts`, `isAutomatableRole` in `src/lib/ai-fit.ts`).

# Nightly AI-fit score

`src/lib/ai-fit.ts` turns the research's sourced facts into a 0 to 100 score; the model never asserts a score itself.

| Criterion | Max | Points |
|---|---:|---|
| hiring | 25 | 12 per distinct automatable role (4 at most), plus 5 for a cluster of 3 or more. The link must be on the company's site or a job board. |
| scale | 20 | 10 for 3+ locations (5 for 2); 10 for 50+ field staff, else a stated volume: 8 at 1,000+, 5 at 100+, 3 below. A volume with no number earns nothing. |
| change | 20 | 14 per distinct event (same kind within a month is one event), 3 at most. |
| techOpenness | 20 | 12 per distinct statement, 3 at most. |
| systems | 15 | 8 per distinct system. The link must be on the company's site, a job posting, or a specific page elsewhere; a vendor's homepage earns nothing. |

Freshness: full points in the first half of each window (hiring 90 days, change 365, openness 540), 70% in the second half, nothing after it. Undated items earn half. A date more than 7 days in the future earns nothing. Dates must be `YYYY-MM-DD` or `YYYY-MM`; anything else counts as undated.

Grounding (`src/lib/evidence-grounding.ts`): an item whose link a search returned is "seen". Any other link gets one page check (https only, public hosts only, 3 redirects, 300KB, about 8 seconds for all of a company's checks). It is "confirmed" when the page shows the claim and "dropped" when the page is missing, closed or says something else. A page that blocks the check, times out or needs a browser leaves the item "unverified". Dropped and unverified items earn 0 and are listed in the row's limitations.

Disqualifiers zero the score only when they are one of `software_or_it`, `inhouse_ai_team`, `closing_or_acquired`, `subsidiary_of_large_company` or `franchise_unit` with an https source. Anything else the research worries about is kept as a concern and never changes the score.

Learning: sector weights come from the first email per listed card and the card's best outcome (a positive or referral reply, a meeting, qualified or opportunity stage), shrunk toward the overall rate by 5 pseudo-positives and kept between 0.7 and 1.5. Nothing is learned until there are 5 positives overall. The weight decides the night's best sector; the base sector order only breaks ties. `fitOutcomes` reports replies by fit band and criterion for review only; it never changes the minimum fit or the caps.
