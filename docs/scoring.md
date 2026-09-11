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

AI/ML, automation and process, data and reporting, systems/integration, CRM administration, and the analyst seats in RevOps and operations. These are the hires where Nine-67 builds the system instead. Sales reps, support desks and leadership hires do not qualify; the one exception is a leader hired to build AI or automation, which counts as a mandate.
