# Night Watch

Night Watch is Nine-67's human-approved, signal-led outbound engine. It finds recent buying signals, maps them to likely owners, scores the opportunity, and drafts outreach. Nothing sends without a human click.

## Application

The full application lives in `src/`, with schema and policies in `supabase/migrations/`. It includes the nightly pipeline, morning desk, human approval workflow, Gmail sending, reply classification, and statistics.

See `docs/DEPLOYMENT.md` to configure Supabase, Google OAuth, Apollo, Anthropic, and Vercel.

## Manual proof assets

The build brief requires a five-night manual validation before application development begins.

Exit criteria:

- Research 20 accounts per night for five nights.
- Produce at least 10 cards worth acting on.
- Receive at least 2 replies from human-approved outreach.

If the exit criteria are missed, revise the ICP or signal taxonomy before building the automated pipeline.

## Phase 0 workflow

1. Fill `data/accounts.csv` with the initial ICP accounts.
2. Add Nine-67's current positioning and proof points to `positioning.md`.
3. Each night, select 20 active accounts not researched in the previous 20 hours.
4. Run `prompts/scout.md` for each account using public web sources from the last 48 hours.
5. Record qualifying signals in `data/signals.csv`.
6. Identify the responsible person and verify their email manually in Apollo.
7. Calculate the deterministic score using `docs/scoring.md`.
8. For scores of 60 or more, draft and review outreach using `prompts/angle-writer.md`; record it in `data/cards.csv`.
9. Josh or Jenna sends manually from Gmail and records outcomes in `data/touches.csv`.
10. Update `data/nightly-runs.csv` at the end of each run.

## Guardrails

- Human approval is mandatory for every send.
- Send only to Apollo-verified addresses.
- Maximum 15 emails per sender per day.
- Plain text, no tracking pixels, no images, no more than one link.
- LinkedIn actions are manual; never scrape behind login.
- Exclude clients, do-not-contact accounts, and do-not-contact people.

The source specification for this project is the attached “Night Watch: Build Brief” (version 1.0, September 2026). Phase-specific decisions and implementation notes will be preserved under `docs/` as the project advances.
