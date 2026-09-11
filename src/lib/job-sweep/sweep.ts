import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoutSignal } from "../agents.ts";
import { searchPeopleByTitle } from "../apollo-search.ts";
import {
  accountIdsInOpenRuns, ensureAccountsLoaded, finalizeRun, persistSignal, refreshRunAggregates, summarize, sweepStaleRuns,
  type AccountOutcome, type RunNightlyResult, type StopReason,
} from "../pipeline.ts";
import { classifyResearchError, ResearchError, researchPreflight } from "../research-errors.ts";
import { disqualifySignal, searchAiPosts, searchJobBoards, searchPeopleWeb } from "../agents.ts";
import { searchLeadership, searchPeopleByTitles } from "../apollo-search.ts";
import { upsertPerson } from "../pipeline.ts";
import { recomputeAccountIntel } from "../account-intel.ts";
import { scopeCondition, type RunScope } from "../run-scope.ts";
import { searchQueries, populateSweepConfig, sweepAccountLimit, sweepAiPosts, sweepBudgetUsd, sweepConcurrency, sweepContacts, sweepCooldownMs, sweepSearchFallback, timeBudgetMs } from "../run-config.ts";
import { requireSchema } from "../schema-check.ts";
import { admin } from "../supabase/admin.ts";
import { targetAccountByDomain } from "../target-accounts.ts";
import type { Account } from "../types.ts";
import { CAREERS_PATHS, careersLinkFromHomepage, detectAts, fetchPostings, fetchText, postingsFromHtml, type AtsRef, type Fetcher, type Posting } from "./ats.ts";
import { classifyTitle, FAMILY_LABEL, operatingNeedFor, RETIRED_FAMILIES, type JobFamily } from "./classify.ts";
import { scrapeTeamPeople } from "./team-page.ts";
import { aboutAi, discoverLinkedIn } from "../linkedin-discovery.ts";
import { runQueries } from "../web-search.ts";
import { fillEmailsFromPattern } from "../email-fill.ts";
import { jsonLdPostings, sitemapPostings } from "./discover.ts";

type Db = SupabaseClient;

export type SweepSource = "sweep" | "sweep_manual";

export type SweepOptions = {
  source: SweepSource;
  runId?: string;
  accountLimit?: number;
  accountIds?: string[];
  timeBudgetMs?: number;
  concurrency?: number;
  /** Initial populate: read every careers page now, cooldown or not. */
  ignoreCooldown?: boolean;
  /** Extensive first pass: research model, more searches, contacts for every company, no cooldown gating. Passed on every continuation call. */
  populate?: boolean;
  /** Companies the sweep may pick from when no ids are given. Defaults to the reach-out list. */
  scope?: RunScope;
  /** Finish an idle open sweep before creating a new one. Scheduled sweeps always do. */
  resumeIdle?: boolean;
  fetcher?: Fetcher;
  now?: () => number;
};

type CareersStatus = "found" | "listings" | "none" | "error";

/** Who owns the budget for each kind of hire: the person to write to. */
const BUYER_TITLES: Partial<Record<JobFamily, string[]>> = {
  ai_ml: ["Chief Technology Officer", "CTO", "VP Engineering", "Head of AI", "Chief Data Officer", "VP Data", "Head of Data", "Chief Digital Officer"],
  automation: ["Chief Operating Officer", "COO", "VP Operations", "Head of Operations", "Director of Operations", "Chief Transformation Officer", "VP Process Improvement", "Chief of Staff"],
  data_analyst: ["Chief Data Officer", "VP Data", "Head of Analytics", "Director of Analytics", "Chief Financial Officer", "VP Finance", "FP&A Director", "Head of Business Intelligence"],
  revops: ["Chief Revenue Officer", "CRO", "VP Revenue Operations", "Head of Revenue Operations", "VP Sales Operations", "Director of Sales Operations", "VP Sales"],
  ops_analyst: ["Chief Operating Officer", "COO", "VP Operations", "Head of Business Operations", "Director of Operations", "Chief of Staff"],
  systems_integration: ["Chief Information Officer", "CIO", "VP Information Technology", "Director of IT", "Head of Business Systems", "VP Engineering", "Director of Enterprise Applications"],
  crm_admin: ["VP Revenue Operations", "Head of Revenue Operations", "VP Sales Operations", "Chief Revenue Officer", "VP Marketing Operations", "Director of Business Systems"],
};
const GENERAL_BUYER_TITLES = ["Chief Operating Officer", "Chief Information Officer", "Chief Technology Officer", "VP Operations", "Chief of Staff"];

export type SweepAccountResult = {
  careersUrl: string | null;
  ats: AtsRef | null;
  status: CareersStatus;
  note: string;
  postings: Array<Posting & { family: JobFamily | null }>;
  targetPostings: Array<Posting & { family: JobFamily }>;
};

function looksLikeCareersPage(html: string) {
  return /career|job|opening|position|join (us|our team)|hiring|apply/i.test(html);
}

/**
 * Find the company's careers page and read its postings. Order: a board we
 * recorded last time, the homepage's careers link, then common paths.
 */
export async function sweepAccount(account: Account & { ats_provider?: string | null; ats_ref?: string | null }, fetcher: Fetcher, now = new Date()): Promise<SweepAccountResult> {
  const classify = (postings: Posting[]) => postings.map((posting) => ({ ...posting, family: classifyTitle(posting.title) }));
  const finish = (careersUrl: string | null, ats: AtsRef | null, status: CareersStatus, note: string, postings: Array<Posting & { family: JobFamily | null }>): SweepAccountResult => ({
    careersUrl, ats, status, note, postings, targetPostings: postings.filter((posting): posting is Posting & { family: JobFamily } => posting.family !== null),
  });

  if (account.ats_provider && account.ats_ref) {
    const ats = { provider: account.ats_provider as AtsRef["provider"], ref: account.ats_ref };
    const postings = classify(await fetchPostings(fetcher, ats, now));
    if (postings.length) return finish(account.careers_url, ats, "listings", `${postings.length} postings on ${ats.provider}`, postings);
  }

  const candidates: string[] = [];
  if (account.careers_url) candidates.push(account.careers_url);
  let homepageHtml = "";
  for (const home of [`https://www.${account.domain}/`, `https://${account.domain}/`]) {
    try {
      const page = await fetchText(fetcher, home);
      if (page.ok) {
        homepageHtml = page.body;
        const link = careersLinkFromHomepage(page.body, home);
        if (link) candidates.push(link);
        const ats = detectAts(page.body, home);
        if (ats) {
          const postings = classify(await fetchPostings(fetcher, ats, now));
          return finish(link ?? home, ats, postings.length ? "listings" : "found", `${postings.length} postings on ${ats.provider}`, postings);
        }
        break;
      }
    } catch {
      // Try the next form of the homepage.
    }
  }
  candidates.push(`https://careers.${account.domain}/`, `https://jobs.${account.domain}/`);
  for (const path of CAREERS_PATHS) candidates.push(`https://www.${account.domain}${path}`, `https://${account.domain}${path}`);

  const tried = new Set<string>();
  let firstCareersPage: { url: string; html: string } | null = null;
  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    let page: { ok: boolean; status: number; body: string };
    try {
      page = await fetchText(fetcher, candidate);
    } catch {
      continue;
    }
    if (!page.ok) continue;
    const ats = detectAts(page.body, candidate);
    if (ats) {
      const postings = classify(await fetchPostings(fetcher, ats, now));
      return finish(candidate, ats, postings.length ? "listings" : "found", `${postings.length} postings on ${ats.provider}`, postings);
    }
    if (!firstCareersPage && looksLikeCareersPage(page.body)) firstCareersPage = { url: candidate, html: page.body };
    if (firstCareersPage && tried.size >= 8) break;
  }

  const hosts = [`www.${account.domain}`, account.domain, `careers.${account.domain}`, `jobs.${account.domain}`];
  if (firstCareersPage) {
    // Structured data first (exact titles and dates), then the page's own links, then the sitemap.
    const structured = jsonLdPostings(firstCareersPage.html, firstCareersPage.url).map((posting) => ({ ...posting, source: "jsonld" as const }));
    if (structured.length) return finish(firstCareersPage.url, null, "listings", `${structured.length} postings from structured data`, classify(structured));
    const linked = classify(postingsFromHtml(firstCareersPage.html, firstCareersPage.url));
    if (linked.length) return finish(firstCareersPage.url, null, "listings", `${linked.length} postings read from the page`, linked);
    const mapped = classify((await sitemapPostings(fetcher, hosts)).map((posting) => ({ ...posting, source: "sitemap" as const })));
    if (mapped.length) return finish(firstCareersPage.url, null, "listings", `${mapped.length} postings from the sitemap (titles read from URLs)`, mapped);
    return finish(firstCareersPage.url, null, "found", "Careers page found; listings are rendered by script, and no sitemap or structured data lists them", []);
  }
  const ats = homepageHtml ? detectAts(homepageHtml, `https://${account.domain}/`) : null;
  if (ats) {
    const postings = classify(await fetchPostings(fetcher, ats, now));
    return finish(null, ats, postings.length ? "listings" : "found", `${postings.length} postings on ${ats.provider}`, postings);
  }
  const mapped = classify((await sitemapPostings(fetcher, hosts)).map((posting) => ({ ...posting, source: "sitemap" as const })));
  if (mapped.length) return finish(null, null, "listings", `${mapped.length} postings from the sitemap (titles read from URLs)`, mapped);
  return finish(null, null, "none", "No careers page found at the homepage link, careers/jobs subdomains, common paths or sitemap", []);
}

/**
 * Read the detail page of each target posting that lacks a date, for the
 * JobPosting structured data most job pages carry: date, salary, description,
 * and sometimes a cleaner title than the slug gave us. A few fetches per company.
 */
export async function enrichTargetPostings(result: SweepAccountResult, fetcher: Fetcher, limit = 6) {
  const candidates = result.targetPostings.filter((posting) => !posting.postedAt || posting.source === "sitemap").slice(0, limit);
  await Promise.all(candidates.map(async (posting) => {
    try {
      const page = await fetchText(fetcher, posting.url);
      if (!page.ok) return;
      const detail = jsonLdPostings(page.body, posting.url)[0];
      if (!detail) return;
      posting.postedAt = posting.postedAt ?? detail.postedAt;
      posting.salaryMax = posting.salaryMax ?? detail.salaryMax;
      posting.description = posting.description ?? detail.description;
      posting.location = posting.location ?? detail.location;
      if (posting.source === "sitemap" && detail.title) posting.title = detail.title;
    } catch {
      // Enrichment is best effort.
    }
  }));
}

/** Ask a small model to list the company's roles from public job boards. Only when nothing could be read directly. */
export async function searchFallback(account: Account, result: SweepAccountResult, recordCost: (cost: number) => void, maxSearches: number, modelOverride?: string): Promise<SweepAccountResult> {
  const { postings, model } = await searchJobBoards(account, recordCost, { maxSearches, model: modelOverride });
  const classified = postings.map((posting) => ({
    externalId: null, title: posting.title, url: posting.url, location: posting.location, department: null,
    postedAt: posting.posted_at && /^\d{4}-\d{2}-\d{2}/.test(posting.posted_at) ? posting.posted_at.slice(0, 10) : null,
    source: "web_search" as const, family: classifyTitle(posting.title),
  }));
  return {
    ...result,
    status: classified.length ? "listings" : result.status,
    note: classified.length ? `${classified.length} postings found on public job boards by ${model}${result.note ? ` (${result.note.toLowerCase()})` : ""}` : `${result.note}; a job-board search by ${model} found nothing either`,
    postings: [...result.postings, ...classified],
    targetPostings: [...result.targetPostings, ...classified.filter((posting): posting is typeof posting & { family: JobFamily } => posting.family !== null)],
  };
}

function daysBetween(from: string, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - Date.parse(from)) / 86_400_000));
}

/** Turn the target postings into one hiring signal, with the buyer from the target file or Apollo. */
export async function hiringSignal(account: Account, result: SweepAccountResult, rows: Array<{ url: string; first_seen_at: string; posted_at: string | null }>, now: Date): Promise<ScoutSignal | null> {
  const target = result.targetPostings;
  if (!target.length) return null;
  const firstSeen = new Map(rows.map((row) => [row.url, row]));
  const observed = target
    .map((posting) => posting.postedAt ?? firstSeen.get(posting.url)?.first_seen_at?.slice(0, 10) ?? now.toISOString().slice(0, 10))
    .sort()
    .at(-1)!;
  const oldest = target
    .map((posting) => posting.postedAt ?? firstSeen.get(posting.url)?.first_seen_at ?? now.toISOString())
    .map((date) => daysBetween(date, now))
    .sort((left, right) => right - left)[0] ?? 0;
  const families = [...new Set(target.map((posting) => posting.family))];
  const titles = [...new Set(target.map((posting) => posting.title))];
  const context = targetAccountByDomain.get(account.domain);
  const people: ScoutSignal["people"] = [];
  if (context?.ceo) people.push({ name: context.ceo, title: "CEO", role_in_signal: "budget owner from the target file" });
  else {
    try {
      const found = await searchPeopleByTitle(account.domain, context?.targetTitles ?? account.target_titles ?? []);
      if (found) people.push({ name: found.name, title: found.title, role_in_signal: "likely buyer by title" });
    } catch (error) {
      console.warn(`[night-watch] Apollo title search failed for ${account.domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const lead = target[0];
  return {
    type: target.length >= 2 ? "job_cluster" : "job_post",
    summary: `${target.length} open ${families.map((family) => FAMILY_LABEL[family].toLowerCase()).join(" and ")} role${target.length === 1 ? "" : "s"}: ${titles.slice(0, 4).join(", ")}${titles.length > 4 ? ` and ${titles.length - 4} more` : ""}.`,
    source_url: result.careersUrl ?? lead.url,
    observed_at: observed,
    operating_need: operatingNeedFor(target),
    evidence_kind: "hiring",
    people,
    job: {
      title: target.length === 1 ? lead.title : `${target.length} roles: ${titles.slice(0, 3).join(", ")}`,
      department: lead.department ?? FAMILY_LABEL[lead.family],
      days_open: oldest,
      reposted: false,
      salary_max: Math.max(0, ...target.map((posting) => posting.salaryMax ?? 0)),
      tools_named: [],
      responsibilities: titles.slice(0, 8),
    },
    confidence: 0.9,
  };
}

async function selectAccounts(db: Db, options: SweepOptions, now: number) {
  const busy = await accountIdsInOpenRuns(db);
  if (options.accountIds?.length) {
    const { data } = await db.from("accounts").select("id,name,domain,outreach").in("id", options.accountIds).eq("status", "active");
    return (data ?? []).filter((account) => !busy.has(account.id));
  }
  const limit = Math.max(1, Math.min(2000, Math.floor(options.accountLimit ?? sweepAccountLimit())));
  const cutoff = new Date(now - sweepCooldownMs()).toISOString();
  let query = db.from("accounts").select("id,name,domain,outreach").eq("status", "active").not("domain", "like", "%.example");
  const condition = scopeCondition(options.scope ?? "outreach");
  if (condition) query = query.eq(condition.column, condition.value);
  if (!options.ignoreCooldown) query = query.or(`careers_checked_at.is.null,careers_checked_at.lt.${cutoff}`);
  // Reach-out companies first, then whoever has waited longest.
  const { data, error } = await query.order("outreach", { ascending: false }).order("careers_checked_at", { ascending: true, nullsFirst: true }).order("name").limit(limit + busy.size);
  if (error) throw error;
  return (data ?? []).filter((account) => !busy.has(account.id)).slice(0, limit);
}

async function createSweepRun(db: Db, options: SweepOptions, now: number) {
  const batch = await selectAccounts(db, options, now);
  const { data: run, error } = await db.from("runs").insert({ started_at: new Date(now).toISOString(), heartbeat_at: new Date(now).toISOString(), status: "open", source: options.source, requested_accounts: batch.length }).select("id").single();
  if (error) throw error;
  if (batch.length) {
    const { error: rowsError } = await db.from("run_accounts").insert(batch.map((account, index) => ({ run_id: run.id, account_id: account.id, position: index + 1, domain: account.domain, name: account.name })));
    if (rowsError) throw rowsError;
  }
  return run.id as string;
}

/**
 * Read careers pages for a batch of companies with a small concurrency pool,
 * record every posting, and raise hiring signals. Same run record, time
 * budget, cost budget and stop handling as the research run.
 */
export async function runSweep(options: SweepOptions): Promise<RunNightlyResult> {
  researchPreflight();
  const db = admin();
  await requireSchema(db);
  const clock = options.now ?? Date.now;
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const started = clock();
  const budget = options.timeBudgetMs ?? timeBudgetMs(options.source === "sweep" ? "scheduled" : "manual");
  const extensive = options.populate ? populateSweepConfig() : null;
  const costBudget = extensive?.budgetUsd ?? sweepBudgetUsd();
  const fallback = { ...sweepSearchFallback(), ...(extensive ? { enabled: true, cooldownMs: 0, maxSearches: extensive.searches } : {}) };
  const posts = { ...sweepAiPosts(), ...(extensive ? { enabled: true, cooldownMs: 0, maxSearches: extensive.searches } : {}) };
  const contacts = { ...sweepContacts(), ...(extensive ? { mode: "all" as const, cooldownMs: 0 } : {}) };
  const modelOverride = extensive?.model;
  const concurrency = Math.max(1, Math.min(12, options.concurrency ?? sweepConcurrency()));

  await sweepStaleRuns(db, started);
  await ensureAccountsLoaded(db);
  // Postings classified under families that no longer qualify stop counting as target roles.
  await db.from("job_postings").update({ family: null }).in("family", RETIRED_FAMILIES);

  let runId = options.runId ?? null;
  if (runId) {
    const { data: run } = await db.from("runs").select("id,status").eq("id", runId).maybeSingle();
    if (!run) throw new ResearchError("unknown", "That sweep does not exist.");
    if (run.status !== "open") return summarize(db, runId, "already_closed", 0, 0);
  } else if ((options.source === "sweep" || options.resumeIdle) && !options.accountIds?.length) {
    const idleCutoff = new Date(started - 2 * 60_000).toISOString();
    const { data: idle } = await db.from("runs").select("id").eq("status", "open").eq("cancel_requested", false).in("source", ["sweep", "sweep_manual"])
      .or(`heartbeat_at.is.null,heartbeat_at.lt.${idleCutoff}`).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (idle) {
      const { count } = await db.from("run_accounts").select("*", { count: "exact", head: true }).eq("run_id", idle.id).eq("status", "queued");
      if ((count ?? 0) > 0) runId = idle.id;
    }
  }
  if (!runId) runId = await createSweepRun(db, options, started);
  const id = runId;

  let processed = 0;
  let invocationCost = 0;
  // Workers assign these inside closures, so keep them on an object TypeScript cannot narrow.
  const state: { stopped: StopReason; halt: boolean } = { stopped: "finished", halt: false };

  const worker = async () => {
    while (!state.halt) {
      const now = clock();
      if (now - started >= budget) { state.stopped = "time_budget"; state.halt = true; break; }
      if (invocationCost >= costBudget) { state.stopped = "cost_budget"; state.halt = true; break; }
      const { data: fresh } = await db.from("runs").select("cancel_requested,status").eq("id", id).single();
      if (fresh?.status !== "open") { state.stopped = "already_closed"; state.halt = true; break; }
      if (fresh.cancel_requested) { state.stopped = "cancelled"; state.halt = true; break; }
      const { data: next } = await db.from("run_accounts").select("id,account_id,domain").eq("run_id", id).eq("status", "queued").order("position").limit(1).maybeSingle();
      if (!next) break;
      const { data: claimed } = await db.from("run_accounts").update({ status: "running", started_at: new Date(now).toISOString() }).eq("id", next.id).eq("status", "queued").select("id").maybeSingle();
      if (!claimed) continue;
      const rowStart = clock();
      let update: Record<string, unknown>;
      try {
        const { data: account } = await db.from("accounts").select("*").eq("id", next.account_id).maybeSingle();
        if (!account) throw new ResearchError("db_error", `Account ${next.domain} no longer exists.`);
        const sweepStart = new Date(rowStart).toISOString();
        let result = await sweepAccount(account as Account, fetcher, new Date(rowStart));
        const outcome: AccountOutcome = { signalsFound: 0, signalsKept: 0, signalsNew: 0, cardsCreated: 0, costUsd: 0, model: null };
        const recordCost = (cost: number) => { outcome.costUsd += cost; invocationCost += cost; };
        const searchDue = !account.job_search_checked_at || Date.parse(account.job_search_checked_at) < rowStart - fallback.cooldownMs;
        if (!result.postings.length && fallback.enabled && searchDue) {
          try {
            result = await searchFallback(account as Account, result, recordCost, fallback.maxSearches, modelOverride);
          } catch (error) {
            const classified = classifyResearchError(error);
            console.warn(`[night-watch] job-board search failed for ${next.domain} (${classified.code}): ${classified.message}`);
            result = { ...result, note: `${result.note}; job-board search failed (${classified.code})` };
          }
          await db.from("accounts").update({ job_search_checked_at: sweepStart }).eq("id", account.id);
        }
        await enrichTargetPostings(result, fetcher);
        for (const posting of result.postings) {
          const { error } = await db.from("job_postings").upsert({
            account_id: account.id, external_id: posting.externalId, title: posting.title, url: posting.url, location: posting.location, department: posting.department,
            family: posting.family, posted_at: posting.postedAt, last_seen_at: sweepStart, active: true, raw: posting.raw ?? {},
            source: posting.source ?? "careers", salary_max: posting.salaryMax ?? null, description: posting.description ?? null,
          }, { onConflict: "account_id,url" });
          if (error) throw error;
        }
        if (result.status === "listings") {
          await db.from("job_postings").update({ active: false }).eq("account_id", account.id).eq("active", true).lt("last_seen_at", sweepStart);
        }
        await db.from("accounts").update({
          careers_url: result.careersUrl ?? account.careers_url, ats_provider: result.ats?.provider ?? null, ats_ref: result.ats?.ref ?? null,
          careers_checked_at: sweepStart, careers_status: result.status, careers_note: result.note,
        }).eq("id", account.id);

        outcome.signalsFound = result.postings.length;
        outcome.signalsKept = result.targetPostings.length;
        if (result.targetPostings.length) {
          const { data: rows } = await db.from("job_postings").select("url,first_seen_at,posted_at").eq("account_id", account.id).eq("active", true).not("family", "is", null);
          const signal = await hiringSignal(account as Account, result, rows ?? [], new Date(rowStart));
          if (signal) await persistSignal(account as Account, signal, outcome, recordCost);
        }
        // LinkedIn and the rest of the public web, from search results read by URL pattern: profiles by the
        // titles that matter and by department, posts from several angles, articles, posts by people already on
        // file, and X, Medium, Substack, YouTube and podcasts. Search agents run the queries; no LinkedIn automation.
        let postsFound = 0;
        let linkedinNote: string | null = null;
        const linkedin: { people: Array<{ name: string; title: string; url: string }>; posts: Array<{ author: string; excerpt: string; url: string; kind: string; date: string | null }> } = { people: [], posts: [] };
        {
          try {
            const context = targetAccountByDomain.get(account.domain);
            const { data: known } = await db.from("people").select("full_name").eq("account_id", account.id).limit(12);
            const found = await discoverLinkedIn(account.name, [...new Set([...(context?.targetTitles ?? account.target_titles ?? []), ...result.targetPostings.flatMap((posting) => BUYER_TITLES[posting.family] ?? [])])].slice(0, 24), (known ?? []).map((row) => row.full_name as string), (queries) => runQueries(queries, { recordUsage: recordCost }), extensive ? searchQueries() : Math.min(12, searchQueries()));
            linkedin.people = found.people;
            linkedin.posts = found.posts;
            for (const post of found.posts) {
              const { error } = await db.from("public_posts").upsert({
                account_id: account.id, author_name: post.author, author_title: "", url: post.url, platform: post.platform, topic: aboutAi(post.excerpt) ? "AI or automation" : "",
                excerpt: post.excerpt, posted_at: post.date, found_by: `search:${found.provider}`, raw: post,
              }, { onConflict: "account_id,url" });
              if (error) throw error;
              postsFound += 1;
              if (aboutAi(post.excerpt) && post.author !== "Unknown") {
                const signal: ScoutSignal = {
                  type: "exec_post", evidence_kind: "ai_post",
                  summary: `${post.author} posted on LinkedIn about AI or automation.`,
                  source_url: post.url, observed_at: post.date ?? sweepStart.slice(0, 10),
                  operating_need: `${post.author} at ${account.name} is talking publicly about AI and automation in their work; Nine-67 could build or run that work with them.`,
                  people: [{ name: post.author, title: "", role_in_signal: "posted" }],
                  post: { text: post.excerpt, author_name: post.author, author_title: "", published_at: post.date, reactions: null, comments: null, reposts: null, hashtags: [], is_excerpt: true },
                  confidence: 0.6,
                };
                if (!disqualifySignal(signal)) await persistSignal(account as Account, signal, outcome, recordCost).catch(() => undefined);
              }
            }
            linkedinNote = `${found.provider}: ${found.queries} searches, ${found.people.length} profiles, ${found.posts.length} posts`;
          } catch (error) {
            linkedinNote = `LinkedIn search failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        // Anyone at the company posting publicly about AI in their own work.
        const postsDue = !account.ai_posts_checked_at || Date.parse(account.ai_posts_checked_at) < rowStart - posts.cooldownMs;
        if (posts.enabled && postsDue) {
          try {
            const { posts: found, model } = await searchAiPosts(account as Account, recordCost, { maxSearches: posts.maxSearches, model: modelOverride });
            for (const post of found) {
              const postedAt = post.posted_at && /^\d{4}-\d{2}-\d{2}/.test(post.posted_at) ? post.posted_at.slice(0, 10) : null;
              const signal: ScoutSignal = {
                type: "exec_post", evidence_kind: "ai_post",
                summary: `${post.author_name}${post.author_title ? ` (${post.author_title})` : ""} posted about ${post.topic || "AI in their own work"}.`,
                source_url: post.url, observed_at: postedAt ?? sweepStart.slice(0, 10),
                operating_need: `${post.author_name} is working on ${post.topic || "AI and automation"} at ${account.name} and said so publicly; Nine-67 could build or run that work with them.`,
                people: [{ name: post.author_name, title: post.author_title, role_in_signal: "posted" }],
                post: { text: post.excerpt, author_name: post.author_name, author_title: post.author_title, published_at: postedAt, reactions: null, comments: null, reposts: null, hashtags: [], is_excerpt: true },
                confidence: 0.8,
              };
              if (disqualifySignal(signal)) continue;
              let personId: string | null = null;
              try {
                personId = (await persistSignal(account as Account, signal, outcome, recordCost)).personId;
              } catch (error) {
                console.warn(`[night-watch] could not store a post signal for ${next.domain}: ${error instanceof Error ? error.message : String(error)}`);
              }
              const { error } = await db.from("public_posts").upsert({
                account_id: account.id, person_id: personId, author_name: post.author_name, author_title: post.author_title, url: post.url,
                platform: post.platform, topic: post.topic, excerpt: post.excerpt, posted_at: postedAt, found_by: model, raw: post,
              }, { onConflict: "account_id,url" });
              if (error) throw error;
              postsFound += 1;
            }
          } catch (error) {
            const classified = classifyResearchError(error);
            console.warn(`[night-watch] AI-posts scan failed for ${next.domain} (${classified.code}): ${classified.message}`);
          }
          await db.from("accounts").update({ ai_posts_checked_at: sweepStart }).eq("id", account.id);
        }

        // Contacts, from every source there is: Apollo when a key is set, the company's own leadership and team
        // pages, and a web search over LinkedIn profile results and press. The managers behind the open roles come
        // first, then the file's likely buyers, then the CEO. Then the company's email format is learned from any
        // address on file and used to build an address for everyone else.
        let contactsFound = 0;
        let emailsBuilt = 0;
        let contactsNote: string | null = null;
        const contactsDue = !account.contacts_checked_at || Date.parse(account.contacts_checked_at) < rowStart - contacts.cooldownMs;
        // Contacts cost credits; a hold-list company earns them only once it is promoted to the reach-out list.
        const contactsWanted = account.outreach !== false && (contacts.mode === "all" || (contacts.mode === "hiring" && (result.targetPostings.length > 0 || postsFound > 0)));
        if (contactsWanted && contactsDue) {
          const context = targetAccountByDomain.get(account.domain);
          const candidates: Array<{ name: string; title: string; linkedin_url: string | null; source: string }> = [];
          const wantedTitles = [...new Set([
            ...result.targetPostings.flatMap((posting) => BUYER_TITLES[posting.family] ?? []),
            ...(context?.targetTitles ?? account.target_titles ?? []),
            ...GENERAL_BUYER_TITLES,
          ])];
          const problems: string[] = [];
          try {
            candidates.push(...(await searchPeopleByTitles(account.domain, wantedTitles, contacts.perCompany)).map((person) => ({ ...person, source: "apollo" })));
            candidates.push(...(await searchLeadership(account.domain, extensive ? 25 : 10)).map((person) => ({ ...person, source: "apollo" })));
          } catch (error) {
            problems.push(`Apollo: ${error instanceof Error ? error.message : String(error)}`);
          }
          candidates.push(...linkedin.people.map((person) => ({ name: person.name, title: person.title, linkedin_url: person.url, source: "linkedin_search" })));
          try {
            const team = await scrapeTeamPeople(account.domain, fetcher);
            candidates.push(...team.people.map((person) => ({ name: person.name, title: person.title, linkedin_url: person.linkedin_url, source: "team_page" })));
          } catch (error) {
            problems.push(`team page: ${error instanceof Error ? error.message : String(error)}`);
          }
          let emailExamples: string[] = [];
          if (posts.enabled && (extensive || candidates.length < 6)) {
            try {
              const web = await searchPeopleWeb(account as Account, wantedTitles, recordCost, { maxSearches: posts.maxSearches, model: modelOverride });
              candidates.push(...web.people.map((person) => ({ name: person.name, title: person.title, linkedin_url: person.linkedin_url, source: "web_search" })));
              emailExamples = web.emailExamples;
            } catch (error) {
              const classified = classifyResearchError(error);
              problems.push(`people search (${classified.code})`);
            }
          }
          if (context?.ceo) candidates.push({ name: context.ceo, title: "CEO", linkedin_url: null, source: "file" });
          const seen = new Set<string>();
          const cap = extensive ? Math.max(contacts.perCompany, 40) : contacts.perCompany;
          for (const candidate of candidates) {
            const key = candidate.name.toLowerCase().replace(/[^a-z]/g, "");
            if (!key || seen.has(key) || seen.size >= cap) continue;
            seen.add(key);
            try {
              await upsertPerson(account as Account, candidate, candidate.source);
              contactsFound += 1;
            } catch (error) {
              console.warn(`[night-watch] could not store ${candidate.name} at ${next.domain}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          try {
            const filled = await fillEmailsFromPattern(db, account as Account, emailExamples);
            emailsBuilt = filled.built;
            if (filled.pattern) contactsNote = `address format ${filled.pattern.key}@ (${Math.round(filled.pattern.confidence * 100)}% sure)`;
          } catch (error) {
            problems.push(`email pattern: ${error instanceof Error ? error.message : String(error)}`);
          }
          if (problems.length) contactsNote = [contactsNote, `contact lookup problems: ${problems.join("; ")}`].filter(Boolean).join(" · ");
          await db.from("accounts").update({ contacts_checked_at: sweepStart }).eq("id", account.id);
        }

        const families = [...new Set(result.targetPostings.map((posting) => FAMILY_LABEL[posting.family]))];
        const parts = [
          result.targetPostings.length ? `${result.targetPostings.length} of ${result.postings.length} postings in ${families.join(", ")}` : result.note,
          postsFound ? `${postsFound} AI post${postsFound === 1 ? "" : "s"}` : null,
          contactsFound ? `${contactsFound} contact${contactsFound === 1 ? "" : "s"}${emailsBuilt ? ` (${emailsBuilt} addresses built)` : ""}` : null,
          contactsNote,
          linkedinNote,
        ].filter(Boolean);
        update = {
          status: result.targetPostings.length || postsFound ? "ok" : "no_signal",
          signals_found: outcome.signalsFound, signals_kept: outcome.signalsKept + postsFound, signals_new: outcome.signalsNew, cards_created: outcome.cardsCreated,
          cost_usd: Number(outcome.costUsd.toFixed(6)), model: null, error_code: null, error_message: null,
          note: parts.join(" · "),
        };
      } catch (error) {
        const classified = classifyResearchError(error);
        console.error(`[night-watch] sweep failed for ${next.domain} (${classified.code}): ${classified.message}`);
        update = { status: "error", error_code: classified.code, error_message: classified.message };
      }
      const finishedAt = clock();
      await db.from("run_accounts").update({ ...update, finished_at: new Date(finishedAt).toISOString(), duration_ms: finishedAt - rowStart }).eq("id", next.id);
      processed += 1;
      await recomputeAccountIntel(db, next.account_id, new Date(finishedAt)).catch((error) => console.warn(`[night-watch] intel refresh failed for ${next.domain}: ${error instanceof Error ? error.message : String(error)}`));
      await refreshRunAggregates(db, id, finishedAt);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const ended = clock();
  const { stopped } = state;
  if (stopped === "finished" || stopped === "cancelled") {
    await finalizeRun(db, id, stopped === "cancelled" ? "cancelled" : "complete", ended);
  } else if (stopped !== "already_closed") {
    await refreshRunAggregates(db, id, ended);
  }
  const { data: current } = await db.from("runs").select("invocations").eq("id", id).single();
  await db.from("runs").update({ invocations: Number(current?.invocations ?? 0) + 1 }).eq("id", id);
  return summarize(db, id, stopped, processed, invocationCost);
}
