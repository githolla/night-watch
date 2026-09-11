# Night Watch

Night Watch is Nine-67's human-approved, signal-led outbound engine. It finds recent buying signals, maps them to likely owners, scores the opportunity, and drafts outreach. Nothing sends without a human click.

## Application

The full application lives in `src/`, with schema and policies in `supabase/migrations/`. It includes the nightly pipeline, morning desk, human approval workflow, Gmail sending, reply classification, and statistics.

See `docs/DEPLOYMENT.md` to configure Supabase, Anthropic, and Vercel. Gmail and Apollo are optional additions; manual outreach works without either one.

## Target universe

Night Watch ships with the 1,859-company Nine67 outbound target universe. Every company is qualified above $50M in annual revenue by a reported estimate or revenue band. The source CSV lives in `data/Nine67_Outbound_Targets_50M_plus.csv`; the generated runtime data lives in `src/lib/target-accounts.generated.ts`.

Open Workspace → Signal research and choose **Load 1,859 companies** to sync them immediately. If the live account table is empty, the nightly run also loads the list automatically before research starts. After replacing the source CSV, run `npm run targets:generate` before deploying.

## Reach-out list (Tier A)

The cut in `data/Nine67_Outbound_Targets_Cut.xlsx` decides who is contacted. Every company on the file carries a tier: **A1** (first wave) and **A2** (second wave) are the reach-out list; **B** and **C** are held and watched; **Removed** companies are paused. Only reach-out companies get research runs, contact enrichment, dossiers, and a place on the desk. Held companies are swept for a promotion signal only when asked (Runs → *Sweep the held companies*), and anything found shows up as a promotion candidate.

- **Reach-out page** (`/outreach`): the list, searchable and filterable by priority, industry, ownership, state, stage, owner, and evidence (hiring, AI posts, verified emails, dossiers, contacted, changed this week). Tiles and breakdown bars are clickable filters; filters live in the address bar so a view can be sent as a link. Stage, owner, and notes are edited inline; **Export to CSV** downloads the current view.
- **Company page** (`/accounts/<domain>`): everything on file for one company (roles, AI posts, people, signals, dossiers, touches, run history), with the reach-out form and buttons to sweep or research it now.
- **Promotion**: put a held company on the list from its page or from the candidates panel; take one off the same way. A hand decision survives re-syncs. *Follow the tier* clears it.

After replacing the workbook, run `python3 scripts/export-target-cut.py` (needs `openpyxl`) to refresh `data/Nine67_Outbound_Targets_Cut.csv`, then `npm run targets:generate`, then sync on the Accounts page. Migration `supabase/migrations/0009_outreach_tiers.sql` adds the tier and reach-out columns.

## Hero image

One image is used on the Today page, the login screen and every page head. Put it in `public/` as `night-watch-hero.jpg` (or `.png` / `.webp`); until that file exists the earlier nightscape stays in place.

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
3. Each scheduled run enqueues `NIGHTLY_ACCOUNT_LIMIT` companies (default 25) into a run record, never-researched companies first, then the ones checked longest ago; a company is not eligible again for `RESEARCH_COOLDOWN_DAYS` (default 7). The run works inside a time budget and, if the execution window ends first, the next invocation resumes the same run before starting a new batch. Companies the sweep shows are hiring go first. At 25 a night a full pass over 1,859 companies takes 75 nights; the sweep covers the whole list daily. Pressing **Research next companies** on the desk creates one run the same way and shows every company's outcome as it lands.
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
- One invocation, scheduled or manual, stops once measured Anthropic spend reaches `NIGHTLY_RUN_BUDGET_USD` (default `$2.50`) and leaves the remaining companies queued. `NIGHTLY_MAX_COST_PER_ACCOUNT_USD` (default `$0.12`) is the planning figure shown as the projected maximum. Override either only deliberately.
- Every tunable of the run has exactly one default, in `src/lib/run-config.ts`.

## Careers sweep

Most of what Night Watch is looking for is a job post, and job posts do not need a model to read. Every hour (`/api/cron/sweep`, Pro plan) the sweep takes the next `SWEEP_ACCOUNT_LIMIT` companies whose careers page has not been read in `SWEEP_COOLDOWN_HOURS`, finds the careers page from the homepage or common paths, detects the applicant-tracking board (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR, Workday, Recruitee, Breezy, iCIMS, Jobvite) or reads the page's own listings, classifies every title against the target job families with rules in `src/lib/job-sweep/classify.ts`, and stores each posting in `job_postings` with first-seen and last-seen dates. A company with open roles in a target family becomes a `job_post` or `job_cluster` signal whose operating need names the work; the buyer is the CEO from the target file, or a title match from Apollo, and a card is drafted from that. The only model cost is the outreach draft. When the page's listings are rendered by script, the sweep tries three more sources before giving up: JobPosting structured data on the page, the site's sitemap (titles read from the job URLs, then confirmed from each job page), and, at most once every `SWEEP_SEARCH_COOLDOWN_DAYS`, a small-model search of public job boards (`ANTHROPIC_SEARCH_MODEL`, default Haiku, `SWEEP_SEARCH_MAX_SEARCHES` searches) whose results are stored with source `web_search`. Careers and jobs subdomains are tried as well as the main site. Target postings without a date get their job page read for structured data, which also fills in salary and description. Every open role in a target family is listed under Roles, filterable by family and searchable by title or company. The sweep stops one invocation at `SWEEP_RUN_BUDGET_USD` (default $10) of measured spend; only the board search and the outreach drafts cost anything.

## Posts and people

The sweep also runs two more scans per company. The **AI-posts scan** (`SWEEP_AI_POSTS`, weekly per company) asks a small model to find public posts by named people who work at the company about AI, automation or efficiency in their own work: LinkedIn, X, blogs, talks. Press releases, interviews and opinion columns are rejected by the same evidence rules as everything else. Every post is stored in `public_posts` and listed under Posts; a post by a manager or executive becomes an `exec_post` signal with evidence kind `ai_post` and, when it scores, a dossier with the author as the person. **Contact enrichment** (`SWEEP_CONTACTS`, default `hiring`) stores the CEO from the target file and up to `SWEEP_CONTACTS_PER_COMPANY` buyer-title matches from Apollo for every company with open target roles or AI posts, enriched with email and LinkedIn when `APOLLO_API_KEY` is set, refreshed every `SWEEP_CONTACTS_COOLDOWN_DAYS`. They are listed under People with level and email state. Set `SWEEP_CONTACTS=all` to enrich every company regardless.

## Baseline, then updates

The intended rhythm: one extensive first pass builds the baseline for every company (roles, posts, contacts, drafted dossiers), and from then on the hourly sweep and the nightly research are the update pass. Each company carries an intelligence score (0–100) recomputed whenever the sweep or a signal touches it: open target roles (up to 45, more for several families and fresher postings), AI posts (up to 30), contacts (15 with a verified email), open dossiers (10). The formula is `intelScore()` in `src/lib/account-intel.ts`. Accounts sorts by that score by default and can be filtered to companies that changed this week, are hiring, have AI posts, or have a verified email. The desk rail shows what changed since yesterday: new target roles, roles closed, new posts, new contacts. Roles, Posts and People each take a "since" filter. The nightly research goes first to companies that changed in the last two days, then to the highest scores.

## Initial populate

The desk has two one-time buttons for filling an empty database, and both are the thorough pass, not the cheap one. "Initial populate: extensive sweep" reads every careers page, sitemap and job board for all companies immediately, runs the job-board search and the AI-posts search for every company on the research model (`POPULATE_SWEEP_MODEL`) with `POPULATE_SWEEP_SEARCHES` searches each (default 5), enriches contacts for every company, and pauses at `POPULATE_SWEEP_BUDGET_USD` (default $200) per press. "Initial populate: research every company" researches up to `POPULATE_ACCOUNT_LIMIT` companies (default all), hiring companies first, ignoring the 7-day cooldown, with `POPULATE_MAX_SEARCHES` web searches each (default 8) until `POPULATE_RUN_BUDGET_USD` (default $150) per press. Anything past a budget stays queued and the next press continues it. The hourly and nightly runs keep their cheaper defaults.

## Research runs

- A run is one row in `runs` plus one row per company in `run_accounts`, which records the status (`queued`, `running`, `ok`, `no_signal`, `error`, `cancelled`), an error code and message, signals found and kept, cost and duration. The desk, the run panel and the history all read from that table.
- A company is marked researched only when its research succeeds. A failed company keeps its place in the rotation and can be retried at once.
- Error codes: `config` (a missing key or a disabled web search tool), `upstream_auth`, `upstream_rate_limit`, `upstream_error`, `truncated` (the model ran out of output tokens), `parse` (the reply was not JSON), `validation` (the JSON did not match the schema), `db_constraint`, `db_error`, `timeout`, `unknown`.
- Score thresholds are named constants in `src/lib/scoring.ts`: a card is created at 60, shown as priority at 75, and archived when recency decay takes it below 45.

The source specification for this project is the attached “Night Watch: Build Brief” (version 1.0, September 2026). Phase-specific decisions and implementation notes will be preserved under `docs/` as the project advances.
