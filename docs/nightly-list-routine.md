# Nightly list routine

Each weeknight a Claude Code routine builds tomorrow's reach-out lists and works the email addresses, then loads
them into Night Watch through `POST /api/lists/import`. No paid API inside the app is used: the research happens in
the routine, and the app re-checks every cited page before it trusts anything.

## Calling the app

`APP_URL` and `LIST_IMPORT_SECRET` are set in the routine's environment. Every call is:

```
curl -s -X POST "$APP_URL/api/lists/import" -H "Authorization: Bearer $LIST_IMPORT_SECRET" \
  -H "Content-Type: application/json" -d '<json body>'
```

Never print the secret. Actions (JSON body):

| action | body | returns |
|---|---|---|
| `brief` | `{"action":"brief","listDate":"YYYY-MM-DD"}` | revenue band, sectors, list size, minimum fit and the app's own research prompt |
| `status` | `{"action":"status","listDate":"..."}` | that date's lists per seat and how many addresses are unconfirmed |
| `check` | `{"action":"check","domains":["a.com",...]}` | which domains are new (`usable`) and why others are out |
| `import` | `{"action":"import","listDate":"...","owner":"josh"\|"suuchi","companies":[...]}` | what was listed, kept as reserve, skipped and why, and address outcomes |
| `addresses` | `{"action":"addresses"}` | unsent list contacts whose address is not yet confirmed |
| `addresses-import` | `{"action":"addresses-import","items":[...]}` | each address: verified, likely or unconfirmed, and why |

Imports can take a few minutes; send at most about 8 companies per `import` call.

## The run

1. Work out `listDate`: the next weekday in America/New_York after the run starts (a run on Sunday to Thursday
   night builds Monday to Friday). Call `status`; if both seats already have 12 rows for that date, skip to step 5.
2. Call `brief` and follow its research prompt and numbers exactly.
3. **Source.** Find about 40 U.S. privately held operating companies inside the revenue band, from published, dated
   rankings that state revenue (LM150, Roofing Contractor Top 100, PCT Top 100, ENR regional lists, business journal
   largest-private-company lists, Inc. 5000 profiles). Spread them across all the `sectors`. Screen them with `check`
   and keep only `usable` ones. Budget web searches: no more than about a third on sourcing.
4. **Research and import.** For each company, produce the research object below, then import. Split the passing
   companies between the two seats so each seat's list mixes sectors: **no more than 3 of a seat's 12 from one
   sector**. Stop a seat at 12 listed. A failed import still marks the domain as known, so import only companies
   that clearly pass the gates.
5. **Addresses.** Call `addresses` and work as many as the remaining budget allows, newest lists first, then
   `addresses-import` what you can prove.
6. Finish with `status` and a short report: per seat, companies listed by sector, addresses confirmed, and what was
   skipped and why.

## Gates a company must pass (or it is skipped)

- Revenue inside the band, reported for a year no more than three years back, with the URL that states it.
- Buyer: the current owner, CEO, President, COO or founder (not a VP, interim, acting or former leader), with a page
  that shows their name and title, ideally the company's own about or team page.
- Not consulting, IT, software, staffing, an agency, a financial firm, a nonprofit or public; not closed or acquired;
  not a franchise unit or a subsidiary of a large company.
- AI fit of at least `minFit` out of 100, scored by the app from evidence it can confirm: fresh open office roles
  (coordination, scheduling, dispatch, estimating, quoting, admin, billing, data entry, customer service, order entry,
  purchasing, reporting), 3+ locations, 50+ field staff or vehicles, changes in the last 12 months (acquisitions, new
  locations, new leaders, investment), leaders' own statements about technology or efficiency, and named business
  systems.
- Workflow fields: lowercase, generic, no numbers, names, places, "your/their/our", question marks, dashes or links.

## How the app confirms evidence

It fetches each cited URL with a plain HTTP GET (no JavaScript) within about 8 seconds. Job titles and system names
must appear word for word; facts mostly; counts as digits. Pages answering 401, 403 or 429, JavaScript-only pages
and timeouts do not count; 404s and closed postings are dropped. So fetch every URL yourself
(`curl -sL -A "Mozilla/5.0" URL`) and confirm the exact text is in the raw HTML before citing it. Company careers
pages and server-rendered applicant systems (Paylocity, ADP, Paycom, BambooHR, Workable, JazzHR, Breezy, Greenhouse,
Lever) usually work; Indeed and LinkedIn usually do not.

## Email evidence

Only two kinds count, and the address must be at the company's own domain:

- `{"kind":"published","address","sourceUrl"}`: the person's own address appears verbatim on a fetchable page.
- `{"kind":"format","address","examples":[{"name","email","sourceUrl"},...]}`: two or more colleagues' addresses,
  each verbatim on a fetchable page, prove one format, and the person's address is exactly what it gives.

Never guess, never use data-broker sites (ZoomInfo, RocketReach, Apollo and the like), and never use a shared inbox.
Confirmed addresses go out with Send all ready and the morning auto-send; everything else waits for a person.

## Company object for `import`

```
{"company":"","domain":"example.com","sector":"","revenueUsdM":null,"revenueYear":null,"sourceUrl":null,
 "research": <the JSON shape the brief's research prompt asks for, revenue inside it>,
 "emailEvidence": <optional, as above>}
```

## Rules

- Never invent a fact, person, address, date or URL. Being wrong is worse than leaving a slot empty.
- Do not scrape search engines with curl to get around a search limit; stop and report instead.
- Do not change code, commit or push in this run.
