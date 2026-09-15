import { disqualifySignal, writeOutreachFromBrief, type ScoutSignal } from "./agents.ts";
import { analyzeCompany, type AnalysisInput, type CompanyAnalysis } from "./analysis.ts";
import { analysisRolesToPostings, channelFor, DRAFT_FIT_FLOOR, draftBreakdown, pickWhoFirst, scoreOfBreakdown, type DraftCandidate } from "./analysis-draft.ts";
import { apolloConfigured, enrichAccountPeople } from "./apollo-enrich.ts";
import { fillEmailsFromPattern } from "./email-fill.ts";
import { verifierConfigured, verifyAccountEmails } from "./email-verify.ts";
import { FAMILY_LABEL, leadRank, type JobFamily } from "./job-sweep/classify.ts";
import { recomputeAccountIntel } from "./account-intel.ts";
import {
  accountIdsInOpenRuns, ensureAccountsLoaded, finalizeRun, isStaleSource, persistSignal, refreshRunAggregates, storeSignalRow, summarize, sweepStaleRuns, upsertPerson,
  type AccountOutcome, type DatedRaw, type RunNightlyResult, type StopReason,
} from "./pipeline.ts";
import { classifyResearchError, ResearchError, researchPreflight } from "./research-errors.ts";
import { analysisConfig, timeBudgetMs } from "./run-config.ts";
import { requireSchema } from "./schema-check.ts";
import { admin } from "./supabase/admin.ts";
import { targetAccountByDomain } from "./target-accounts.ts";
import type { Account } from "./types.ts";

type Db = ReturnType<typeof admin>;
export type AnalysisSource = "analysis" | "analysis_manual";
export type AnalysisOptions = {
  source: AnalysisSource;
  runId?: string;
  accountLimit?: number;
  accountIds?: string[];
  /** Analyse everyone on the list, cooldown or not. */
  force?: boolean;
  resumeIdle?: boolean;
  timeBudgetMs?: number;
  now?: () => number;
};

/** Analyse one company and store everything it produced: people, addresses, voices, signals and the brief. */
export async function analyzeAndStore(db: Db, account: Account, recordCost: (cost: number) => void, outcome: AccountOutcome): Promise<CompanyAnalysis> {
  const config = analysisConfig();
  const target = targetAccountByDomain.get(account.domain);
  const [{ data: roles }, { data: people }, { data: posts }] = await Promise.all([
    db.from("job_postings").select("title,family,url").eq("account_id", account.id).eq("active", true).not("family", "is", null).limit(30),
    db.from("people").select("full_name,title").eq("account_id", account.id).eq("do_not_contact", false).limit(40),
    db.from("public_posts").select("author_name,excerpt,url").eq("account_id", account.id).limit(10),
  ]);
  const input: AnalysisInput = {
    name: account.name, domain: account.domain,
    industry: target?.vertical ?? account.vertical ?? "", subSegment: target?.subSegment ?? "", hq: [target?.hqCity, target?.hqState].filter(Boolean).join(", "),
    ownership: target?.ownership ?? "", revenueBand: target?.revenueBand ?? "", employees: target?.employees ?? null, ceo: target?.ceo ?? "",
    buyerTitles: target?.targetTitles ?? account.target_titles ?? [], aiSignalOnFile: target?.aiSignal ?? "", fileNotes: target?.notes ?? "",
    rolesOnFile: (roles ?? []).map((role) => ({ title: role.title as string, family: FAMILY_LABEL[role.family as JobFamily] ?? String(role.family), url: role.url as string })),
    peopleOnFile: (people ?? []).map((person) => ({ name: person.full_name as string, title: person.title as string })),
    postsOnFile: (posts ?? []).map((post) => ({ author: post.author_name as string, excerpt: post.excerpt as string, url: post.url as string })),
  };
  let cost = 0;
  const record = (value: number) => { cost += value; recordCost(value); };
  const analysis = await analyzeCompany(input, { model: config.model, searches: config.searches }, record);
  analysis.costUsd = Number(cost.toFixed(6));

  for (const person of analysis.people) {
    try { await upsertPerson(account, { name: person.name, title: person.title, linkedin_url: person.linkedin_url }, "analysis"); }
    catch (error) { analysis.problems.push(`could not store ${person.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // Direct details the contact agent saw on public pages: only fill blanks or replace built guesses, never overwrite a verified address.
  for (const contact of analysis.contacts) {
    const email = contact.email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(contact.email) ? contact.email.toLowerCase() : null;
    if (!email && !contact.phone && !contact.linkedin_url) continue;
    try {
      const person = await upsertPerson(account, { name: contact.name, title: contact.title || "Contact", linkedin_url: contact.linkedin_url }, "analysis");
      const patch: Record<string, unknown> = {};
      if (email && (!person.email || person.email_source === "pattern") && person.email_status !== "verified") { patch.email = email; patch.email_status = "unverified"; patch.email_source = "web"; }
      if (contact.phone && !person.phone) patch.phone = contact.phone;
      if (contact.notes || contact.source_url) patch.contact_notes = [contact.notes, contact.source_url ? `seen at ${contact.source_url}` : null].filter(Boolean).join(" · ");
      if (Object.keys(patch).length) await db.from("people").update(patch).eq("id", person.id);
    } catch (error) { analysis.problems.push(`could not store details for ${contact.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const voice of analysis.voices) {
    if (!/^https?:\/\//.test(voice.url)) continue;
    const postedAt = voice.date && /^\d{4}-\d{2}-\d{2}/.test(voice.date) ? voice.date.slice(0, 10) : null;
    const { error } = await db.from("public_posts").upsert({
      account_id: account.id, author_name: voice.author, author_title: voice.title, url: voice.url, platform: voice.platform, topic: voice.topic,
      excerpt: voice.quote, posted_at: postedAt, found_by: `analysis:${config.model}`, raw: voice,
    }, { onConflict: "account_id,url" });
    if (error) analysis.problems.push(`could not store a quote: ${error.message}`);
  }
  try { await fillEmailsFromPattern(db, account, analysis.emailExamples); } catch (error) { analysis.problems.push(`email pattern: ${error instanceof Error ? error.message : String(error)}`); }
  if (apolloConfigured()) {
    try { await enrichAccountPeople(db, account); } catch (error) { analysis.problems.push(`apollo enrichment: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (verifierConfigured()) {
    try { await verifyAccountEmails(db, account); } catch (error) { analysis.problems.push(`email verification: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // Roles the hiring agent read on LinkedIn Jobs, Indeed and the like go into the postings table, so the
  // Roles tab, the intelligence score and the hiring signal all see them, not only the careers-page sweep.
  const hiringRead = !analysis.problems.some((problem) => problem.startsWith("hiring:"));
  for (const posting of analysisRolesToPostings(analysis.hiring.roles)) {
    const { error } = await db.from("job_postings").upsert({
      account_id: account.id, title: posting.title, url: posting.url, posted_at: posting.posted_at, family: posting.family, description: posting.description,
      last_seen_at: analysis.analyzedAt, active: true, source: "analysis", raw: { found_by: `analysis:${config.model}` },
    }, { onConflict: "account_id,url" });
    if (error) analysis.problems.push(`could not store role ${posting.title}: ${error.message}`);
  }
  // The hiring agent re-reads the boards each time; a role it no longer sees is closed, unless the agent itself failed.
  if (hiringRead) await db.from("job_postings").update({ active: false }).eq("account_id", account.id).eq("source", "analysis").eq("active", true).lt("last_seen_at", analysis.analyzedAt);
  const kept: Array<{ signal: ScoutSignal; id: string }> = [];
  for (const signal of analysis.signals) {
    const reason = disqualifySignal(signal);
    if (reason) { analysis.problems.push(`signal not kept: ${reason}`); continue; }
    outcome.signalsFound += 1;
    try {
      const stored = await persistSignal(account, signal, outcome, record);
      if (!stored.storedId) { analysis.problems.push("signal not kept: source is older than the freshness window"); continue; }
      outcome.signalsKept += 1;
      kept.push({ signal, id: stored.storedId });
    } catch (error) { analysis.problems.push(`signal not stored: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // The draft: written from the brief for the person the synthesizer chose, whatever the signal scoring says.
  try {
    analysis.draft = await draftFromAnalysis(db, account, analysis, kept, outcome, record);
  } catch (error) {
    analysis.draft = { status: "skipped", person: analysis.brief.whoFirst, cardId: null, reason: `the draft could not be written: ${error instanceof Error ? error.message : String(error)}` };
  }
  const { error } = await db.from("accounts").update({ analysis, analysis_at: analysis.analyzedAt, analysis_model: config.model, analysis_cost_usd: analysis.costUsd }).eq("id", account.id);
  if (error) throw error;
  return analysis;
}

function nameKey(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * The evidence the draft hangs on: the strongest signal the synthesizer
 * kept; else the person's own post; else the roles on job boards; else the
 * brief itself. A card needs a signal row, so one is written when none of
 * the kept signals fits.
 */
function evidenceCandidates(account: Account, analysis: CompanyAnalysis, person: DraftCandidate, quotes: CompanyAnalysis["voices"]): ScoutSignal[] {
  const today = analysis.analyzedAt.slice(0, 10);
  const need = analysis.brief.angle || analysis.hiring.buildInstead[0] || analysis.brief.whyNow || `${account.name} has operating work in ${analysis.tech.length ? analysis.tech.slice(0, 3).join(", ") : "its systems and reporting"} that Nine-67 could build and run instead of a hire.`;
  const confidence = Math.max(0.6, Math.min(1, analysis.brief.fit / 100));
  const candidates: ScoutSignal[] = [];
  const quote = quotes.find((voice) => /^https?:\/\//.test(voice.url));
  if (quote) {
    // A post only counts as fresh evidence if it carries its own real date; an undated quote is left dateless so the staleness gate drops it rather than being stamped "today".
    const quoteDate = quote.date && /^\d{4}-\d{2}-\d{2}/.test(quote.date) ? quote.date.slice(0, 10) : null;
    candidates.push({
      type: "exec_post", evidence_kind: "ai_post", summary: `${person.full_name} said publicly: "${quote.quote.slice(0, 160)}"`, source_url: quote.url, observed_at: quoteDate ?? today, operating_need: need,
      people: [{ name: person.full_name, title: person.title, role_in_signal: "posted" }],
      post: { text: quote.quote, author_name: person.full_name, author_title: person.title, published_at: quoteDate, reactions: null, comments: null, reposts: null, hashtags: [], is_excerpt: true },
      confidence,
    });
  }
  const roles = analysisRolesToPostings(analysis.hiring.roles).filter((role) => role.family).sort((left, right) => leadRank(left.family) - leadRank(right.family));
  if (roles.length) {
    const titles = [...new Set(roles.map((role) => role.title))];
    candidates.push({
      type: roles.length >= 2 ? "job_cluster" : "job_post", evidence_kind: "hiring",
      summary: `${roles.length} open role${roles.length === 1 ? "" : "s"} Nine-67 would build a system for instead: ${titles.slice(0, 4).join(", ")}${titles.length > 4 ? ` and ${titles.length - 4} more` : ""}.`,
      source_url: roles[0].url, observed_at: roles[0].posted_at ?? today, operating_need: need, people: [],
      job: { title: roles.length === 1 ? roles[0].title : `${roles.length} roles: ${titles.slice(0, 3).join(", ")}`, department: "", days_open: 0, reposted: false, salary_max: 0, tools_named: [], responsibilities: analysis.hiring.buildInstead.slice(0, 8) },
      confidence,
    });
  }
  // A dated development is real evidence; an undated one carries no published date, so the staleness gate drops it — it is never stamped "today".
  const development = analysis.happening.find((item) => item.source_url && /^https?:\/\//.test(item.source_url));
  const devDate = development?.date && /^\d{4}-\d{2}-\d{2}/.test(development.date) ? development.date.slice(0, 10) : null;
  candidates.push({
    type: "other", evidence_kind: "new_mandate", summary: analysis.brief.whyNow.split(/(?<=\.)\s+/)[0] || `${account.name}: analysed ${today}`,
    source_url: development?.source_url ?? `https://${account.domain}/`, observed_at: devDate ?? today, operating_need: need, people: [], confidence,
    source: { headline: "", publisher: "", author_name: null, published_at: devDate, excerpt: "" },
  });
  return candidates.filter((candidate) => !disqualifySignal(candidate));
}

/** Statuses a person has already acted on; a fresh analysis never overwrites those. */
const SETTLED = new Set(["approved", "edited", "sent", "replied", "positive", "meeting", "snoozed", "dismissed"]);

async function draftFromAnalysis(db: Db, account: Account, analysis: CompanyAnalysis, kept: Array<{ signal: ScoutSignal; id: string }>, outcome: AccountOutcome, recordCost: (cost: number) => void): Promise<CompanyAnalysis["draft"]> {
  const fit = analysis.brief.fit;
  const named = analysis.brief.whoFirst.trim();
  if (account.outreach === false) return { status: "skipped", person: named, cardId: null, reason: "the company is held, not on the reach-out list" };
  if (fit < DRAFT_FIT_FLOOR) return { status: "skipped", person: named, cardId: null, reason: `fit ${fit}/100 is under the floor of ${DRAFT_FIT_FLOOR}; ${analysis.brief.fitReason || "no reason given"}` };

  const { data } = await db.from("people").select("id,full_name,title,level,email,email_status,linkedin_url,path_score").eq("account_id", account.id).eq("do_not_contact", false).limit(80);
  const people = (data ?? []) as DraftCandidate[];
  let { person } = pickWhoFirst(named, people, analysis.voices.map((voice) => voice.author));
  if (!person && named.split(/\s+/).length >= 2) {
    // The synthesizer named someone the people agent did not store; store them now.
    const seen = analysis.people.find((candidate) => nameKey(candidate.name) === nameKey(named));
    person = (await upsertPerson(account, { name: named, title: analysis.brief.whoFirstTitle || seen?.title || "", linkedin_url: seen?.linkedin_url ?? null }, "analysis")) as DraftCandidate;
  }
  if (!person) return { status: "skipped", person: named, cardId: null, reason: "nobody on file to write to yet" };

  const quotes = analysis.voices.filter((voice) => nameKey(voice.author) === nameKey(person.full_name));
  // The person's own kept signal is already fresh (it cleared persistSignal's gate). Otherwise fall back to the
  // strongest candidate that carries a real, recent date — never a synthetic signal stamped "today" on stale material.
  const own = kept.find((entry) => entry.signal.people.some((who) => nameKey(who.name) === nameKey(person.full_name)) || nameKey(entry.signal.post?.author_name ?? "") === nameKey(person.full_name));
  const fallback = evidenceCandidates(account, analysis, person, quotes).find((candidate) => !isStaleSource(candidate.type, candidate as DatedRaw));
  const evidence = own ?? (fallback ? { signal: fallback, id: null as string | null } : null);
  if (!evidence) return { status: "skipped", person: person.full_name, cardId: null, reason: "no fresh, dated evidence in the last 180 days — held until a current signal appears" };
  const signalId = evidence.id ?? (await storeSignalRow(account, evidence.signal, person.id)).id;

  const { data: existingCard } = await db.from("cards").select("id,status").eq("signal_id", signalId).eq("person_id", person.id).maybeSingle();
  if (existingCard && SETTLED.has(existingCard.status as string)) return { status: "kept", person: person.full_name, cardId: existingCard.id as string, reason: `the draft to ${person.full_name} is already ${existingCard.status}; not rewritten` };

  const target = targetAccountByDomain.get(account.domain);
  const draft = await writeOutreachFromBrief({
    company: { name: account.name, domain: account.domain, industry: target?.vertical ?? account.vertical ?? "" },
    person: {
      name: person.full_name, title: person.title, why: analysis.brief.whoFirstWhy,
      quotes: quotes.slice(0, 3).map((voice) => ({ quote: voice.quote, url: voice.url, date: voice.date })),
      emailState: person.email_status === "verified" ? "verified" : person.email ? "unverified" : "none", linkedin: Boolean(person.linkedin_url),
    },
    brief: { whyNow: analysis.brief.whyNow, angle: analysis.brief.angle, opener: analysis.brief.opener, objections: analysis.brief.objections },
    roles: analysis.hiring.roles.slice(0, 8).map((role) => ({ title: role.title, why: role.why })),
    buildInstead: analysis.hiring.buildInstead.slice(0, 6),
    happening: analysis.happening.slice(0, 6).map((item) => item.text),
  }, recordCost);
  const breakdown = draftBreakdown(fit, person.path_score, evidence.signal.observed_at);
  const payload = {
    score: scoreOfBreakdown(breakdown), score_breakdown: breakdown,
    brief: draft.brief || analysis.brief.whoFirstWhy || analysis.brief.angle, why_now: draft.why_now || analysis.brief.whyNow,
    channel: channelFor(person, quotes.length > 0),
    linkedin_comment: quotes.length ? draft.linkedin_comment : "", linkedin_note: draft.linkedin_note.slice(0, 300), linkedin_message: draft.linkedin_message,
    linkedin_subject: draft.linkedin_subject || null,
    email_subject: draft.email_subject, email_body: draft.email_body,
    status: "new", surfaced_on: analysis.analyzedAt.slice(0, 10),
  };
  if (existingCard) {
    const { error } = await db.from("cards").update(payload).eq("id", existingCard.id);
    if (error) throw error;
    return { status: "written", person: person.full_name, cardId: existingCard.id as string, reason: "rewritten from the fresh analysis" };
  }
  const inserted = await db.from("cards").insert({ signal_id: signalId, person_id: person.id, account_id: account.id, assigned_to: "josh", ...payload }).select("id").single();
  if (inserted.error) throw inserted.error;
  outcome.cardsCreated += 1;
  return { status: "written", person: person.full_name, cardId: inserted.data.id as string, reason: `written for ${person.full_name} from the brief` };
}

async function selectAccounts(db: Db, options: AnalysisOptions, now: number) {
  const busy = await accountIdsInOpenRuns(db);
  if (options.accountIds?.length) {
    const { data } = await db.from("accounts").select("id,name,domain").in("id", options.accountIds).eq("status", "active");
    return (data ?? []).filter((account) => !busy.has(account.id));
  }
  const limit = Math.max(1, Math.min(2000, Math.floor(options.accountLimit ?? 2000)));
  // force is the baseline pass: analyse every reach-out company that has any signal at all.
  if (options.force) {
    const { data, error } = await db.from("accounts").select("id,name,domain")
      .eq("status", "active").eq("outreach", true).not("domain", "like", "%.example").gt("intel_score", 0)
      .order("intel_score", { ascending: false }).order("analysis_at", { ascending: true, nullsFirst: true }).order("name").limit(limit + busy.size);
    if (error) throw error;
    return (data ?? []).filter((account) => !busy.has(account.id)).slice(0, limit);
  }
  // Every night after that is the cheap pass: spend the swarm only where a signal
  // actually arrived. A company qualifies when it has intel and either has never
  // been analysed, or something (a role, a post, a person) entered the database since
  // the last analysis. A company that has not changed is left alone until it does.
  const cooldownFloor = new Date(now - analysisConfig().cooldownMs).toISOString();
  const { data, error } = await db.from("accounts")
    .select("id,name,domain,analysis_at,last_change_at")
    .eq("status", "active").eq("outreach", true).not("domain", "like", "%.example").gt("intel_score", 0)
    .order("last_change_at", { ascending: false, nullsFirst: false }).order("intel_score", { ascending: false })
    .limit((limit + busy.size) * 5 + 50);
  if (error) throw error;
  const eligible = (data ?? []).filter((account) => {
    if (busy.has(account.id)) return false;
    if (!account.analysis_at) return true;
    if (!account.last_change_at) return false;
    // Changed since we last analysed. The cooldown is only a floor, so a company that
    // changes every day is still not re-analysed more than once per cooldown window.
    return Date.parse(account.last_change_at as string) > Date.parse(account.analysis_at as string) && (account.analysis_at as string) < cooldownFloor;
  });
  return eligible.slice(0, limit);
}

/**
 * Analyse a batch of reach-out companies with the agent swarm. Same run
 * record, time budget, cost budget and stop handling as the other runs.
 */
export async function runAnalysis(options: AnalysisOptions): Promise<RunNightlyResult> {
  researchPreflight();
  const db = admin();
  await requireSchema(db);
  const clock = options.now ?? Date.now;
  const started = clock();
  const budget = options.timeBudgetMs ?? timeBudgetMs(options.source === "analysis" ? "scheduled" : "manual");
  const config = analysisConfig();

  await sweepStaleRuns(db, started);
  await ensureAccountsLoaded(db);

  let runId = options.runId ?? null;
  if (runId) {
    const { data: run } = await db.from("runs").select("id,status").eq("id", runId).maybeSingle();
    if (!run) throw new ResearchError("unknown", "That analysis run does not exist.");
    if (run.status !== "open") return summarize(db, runId, "already_closed", 0, 0);
  } else if ((options.source === "analysis" || options.resumeIdle) && !options.accountIds?.length) {
    const idleCutoff = new Date(started - 2 * 60_000).toISOString();
    const { data: idle } = await db.from("runs").select("id").eq("status", "open").eq("cancel_requested", false).in("source", ["analysis", "analysis_manual"])
      .or(`heartbeat_at.is.null,heartbeat_at.lt.${idleCutoff}`).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (idle) {
      const { count } = await db.from("run_accounts").select("*", { count: "exact", head: true }).eq("run_id", idle.id).eq("status", "queued");
      if ((count ?? 0) > 0) runId = idle.id;
    }
  }
  if (!runId) {
    const batch = await selectAccounts(db, options, started);
    const { data: run, error } = await db.from("runs").insert({ started_at: new Date(started).toISOString(), heartbeat_at: new Date(started).toISOString(), status: "open", source: options.source, requested_accounts: batch.length }).select("id").single();
    if (error) throw error;
    if (batch.length) {
      const { error: rowsError } = await db.from("run_accounts").insert(batch.map((account, index) => ({ run_id: run.id, account_id: account.id, position: index + 1, domain: account.domain, name: account.name })));
      if (rowsError) throw rowsError;
    }
    runId = run.id as string;
  }
  const id = runId;
  await db.from("runs").update({ heartbeat_at: new Date(started).toISOString() }).eq("id", id);

  let processed = 0;
  let invocationCost = 0;
  const state: { stopped: StopReason; halt: boolean } = { stopped: "finished", halt: false };

  const worker = async () => {
    while (!state.halt) {
      const now = clock();
      if (now - started >= budget) { state.stopped = "time_budget"; state.halt = true; break; }
      if (invocationCost >= config.budgetUsd) { state.stopped = "cost_budget"; state.halt = true; break; }
      const { data: fresh } = await db.from("runs").select("cancel_requested,status").eq("id", id).single();
      if (fresh?.status !== "open") { state.stopped = "already_closed"; state.halt = true; break; }
      if (fresh.cancel_requested) { state.stopped = "cancelled"; state.halt = true; break; }
      const { data: next } = await db.from("run_accounts").select("id,account_id,domain").eq("run_id", id).eq("status", "queued").order("position").limit(1).maybeSingle();
      if (!next) break;
      const { data: claimed } = await db.from("run_accounts").update({ status: "running", started_at: new Date(now).toISOString() }).eq("id", next.id).eq("status", "queued").select("id").maybeSingle();
      if (!claimed) continue;
      const rowStart = clock();
      let update: Record<string, unknown>;
      const outcome: AccountOutcome = { signalsFound: 0, signalsKept: 0, signalsNew: 0, cardsCreated: 0, costUsd: 0, model: config.model };
      try {
        const { data: account } = await db.from("accounts").select("*").eq("id", next.account_id).maybeSingle();
        if (!account) throw new ResearchError("db_error", `Account ${next.domain} no longer exists.`);
        const analysis = await analyzeAndStore(db, account as Account, (cost) => { outcome.costUsd += cost; invocationCost += cost; }, outcome);
        const parts = [
          `fit ${analysis.brief.fit}`,
          analysis.people.length ? `${analysis.people.length} people` : null,
          analysis.contacts.filter((contact) => contact.email || contact.phone).length ? `${analysis.contacts.filter((contact) => contact.email || contact.phone).length} with direct details` : null,
          analysis.voices.length ? `${analysis.voices.length} quotes` : null,
          analysis.hiring.roles.length ? `${analysis.hiring.roles.length} roles read` : null,
          outcome.signalsKept ? `${outcome.signalsKept} signals` : null,
          analysis.draft?.status === "written" ? `draft written for ${analysis.draft.person}` : analysis.draft?.status === "kept" ? `draft kept (${analysis.draft.person})` : analysis.draft ? `no draft: ${analysis.draft.reason}` : null,
          analysis.problems.length ? `${analysis.problems.length} problems` : null,
        ].filter(Boolean);
        update = {
          status: analysis.brief.fit >= 40 || outcome.signalsKept ? "ok" : "no_signal",
          signals_found: outcome.signalsFound, signals_kept: outcome.signalsKept, signals_new: outcome.signalsNew, cards_created: outcome.cardsCreated,
          cost_usd: Number(outcome.costUsd.toFixed(6)), model: config.model, error_code: null, error_message: null, note: parts.join(" · "),
        };
      } catch (error) {
        const classified = classifyResearchError(error);
        console.error(`[night-watch] analysis failed for ${next.domain} (${classified.code}): ${classified.message}`);
        update = { status: "error", error_code: classified.code, error_message: classified.message, cost_usd: Number(outcome.costUsd.toFixed(6)) };
      }
      const finishedAt = clock();
      await db.from("run_accounts").update({ ...update, finished_at: new Date(finishedAt).toISOString(), duration_ms: finishedAt - rowStart }).eq("id", next.id);
      processed += 1;
      await recomputeAccountIntel(db, next.account_id, new Date(finishedAt)).catch(() => undefined);
      await refreshRunAggregates(db, id, finishedAt);
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  const ended = clock();
  const { stopped } = state;
  if (stopped === "finished" || stopped === "cancelled") await finalizeRun(db, id, stopped === "cancelled" ? "cancelled" : "complete", ended);
  else if (stopped !== "already_closed") await refreshRunAggregates(db, id, ended);
  return summarize(db, id, stopped, processed, invocationCost);
}
