# Night Watch

Night Watch is Nine-67's human-approved, signal-led outbound engine. It finds recent buying signals, maps them to likely owners, scores the opportunity, and drafts outreach. Nothing sends without a human click.

## Application

The full application lives in `src/`, with schema and policies in `supabase/migrations/`. It includes the nightly pipeline, morning desk, human approval workflow, Gmail sending, reply classification, and statistics.

See `docs/DEPLOYMENT.md` to configure Supabase, Anthropic, and Vercel. Gmail and Apollo are optional additions; manual outreach works without either one.

## Target universe

Night Watch ships with the 1,859-company Nine67 outbound target universe. Every company is qualified above $50M in annual revenue by a reported estimate or revenue band. The source CSV lives in `data/Nine67_Outbound_Targets_50M_plus.csv`; the generated runtime data lives in `src/lib/target-accounts.generated.ts`.

Open Workspace → Signal research and choose **Load 1,859 companies** to sync them immediately. If the live account table is empty, the nightly run also loads the list automatically before research starts. After replacing the source CSV, run `npm run targets:generate` before deploying.

## Manual proof assets

The build brief requires a five-night manual validation before application development begins.

Exit criteria:

- Research 20 accounts per night for five nights.
- Produce at least 10 cards worth acting on.
- Receive at least 2 replies from human-approved outreach.

If the exit criteria are missed, revise the ICP or signal taxonomy before building the automated pipeline.

## Phase 0 workflow

1. Sync the maintained 1,859-company target universe from Workspace.
2. Add Nine-67's current positioning and proof points to `positioning.md`.
3. Each scheduled run selects three active accounts not researched in the previous 20 hours. Manual research runs as ten recoverable one-company requests. Set `NIGHTLY_ACCOUNT_LIMIT` only after reviewing observed cost and execution time.
4. Run `prompts/scout.md` for each account using public web sources from the last 48 hours.
5. Record qualifying signals in `data/signals.csv`.
6. Identify the responsible person from public evidence. Optionally enrich their email in Apollo.
7. Calculate the deterministic score using `docs/scoring.md`.
8. For scores of 60 or more, draft and review outreach using `prompts/angle-writer.md`; record it in `data/cards.csv`.
9. Josh or Jenna acts manually through email or LinkedIn and records the touch and outcome in the Morning Desk.
10. Update `data/nightly-runs.csv` at the end of each run.

## Guardrails

- Human approval is mandatory for every send.
- In-app Gmail sending is limited to verified addresses; manual outreach can be recorded without Apollo.
- Maximum 15 emails per sender per day.
- Plain text, no tracking pixels, no images, no more than one link.
- LinkedIn actions are manual; never scrape behind login.
- Exclude clients, do-not-contact accounts, and do-not-contact people.

## Cost controls

- Research uses the already compatibility-tested Sonnet 4.5 model by default and automatically falls back to it if an explicitly configured research model is unavailable.
- Each company uses the supplied source as its first research lead, caps paid web search at three calls, and retains only the strongest verified signal.
- Anthropic response usage is converted to dollars and stored in `runs.cost_usd`; the manual progress result and Learning dashboard report measured spend.
- Defaults cap projected exposure at `$0.12` per account and `$1.25` per scheduled run. Override these with `NIGHTLY_MAX_COST_PER_ACCOUNT_USD` and `NIGHTLY_RUN_BUDGET_USD` only deliberately.
- A manual ten-company batch also stops automatically once measured Anthropic spend reaches `$1.00`.

The source specification for this project is the attached “Night Watch: Build Brief” (version 1.0, September 2026). Phase-specific decisions and implementation notes will be preserved under `docs/` as the project advances.
