import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildGraph, type GraphRecords } from "./graph.ts";
const optionalText = z.string().nullable().optional().transform((value) => value ?? null);
const companySchema = z.object({ id: z.string(), name: z.string(), domain: z.string(), status: z.string(), outreach_stage: optionalText, outreach_owner: optionalText, vertical: optionalText, employee_range: optionalText });
const personSchema = z.object({ id: z.string(), account_id: z.string(), full_name: z.string(), title: z.string(), email: optionalText, email_status: z.string(), do_not_contact: z.boolean() });
const draftSchema = z.object({ id: z.string(), account_id: z.string(), person_id: optionalText, signal_id: optionalText, status: z.string(), email_subject: optionalText, email_body: optionalText, brief: optionalText, assigned_to: z.string(), created_at: z.string() });
const touchSchema = z.object({ id: z.string(), card_id: z.string(), person_id: z.string(), channel: z.string(), sent_at: optionalText, sent_by: z.string(), reply_at: optionalText, reply_classification: optionalText, bounced_at: optionalText });
const signalSchema = z.object({ id: z.string(), account_id: z.string(), person_id: optionalText, type: z.string(), summary: z.string(), source_url: z.string(), observed_at: optionalText });
const jobSchema = z.object({ id: z.string(), account_id: z.string(), title: z.string(), url: z.string(), active: z.boolean(), posted_at: optionalText, family: optionalText });
const postSchema = z.object({ id: z.string(), account_id: z.string(), person_id: optionalText, author_name: z.string(), topic: z.string(), excerpt: optionalText, url: z.string(), posted_at: optionalText });
const discoverySchema = z.object({ id: z.string(), company_domain: optionalText, company_confirmed: z.boolean(), status: z.string(), owner: optionalText, item: z.object({ title: z.string(), text: z.string(), url: z.string(), provider: z.string(), published_at: optionalText, active: z.boolean() }) });
export async function loadMapCompanies(db: SupabaseClient, query = "") {
  let request = db.from("accounts").select("id,name,domain,status,outreach_stage,outreach_owner,vertical,employee_range").not("domain", "like", "%.example");
  const safe = query.trim().replace(/[%,()*]/g, " ").slice(0, 80);
  if (safe) request = request.or(`name.ilike.%${safe}%,domain.ilike.%${safe}%`);
  const rows = await readPages((from, to) => request.order("id").range(from, to));
  return companySchema.array().parse(rows);

}
export async function loadRelationshipGraph(db: SupabaseClient, domain: string, now = Date.now()) {
  const account = await db.from("accounts").select("id,name,domain,status,outreach_stage,outreach_owner,vertical,employee_range").eq("domain", domain).maybeSingle();
  if (account.error) throw new Error("Could not load this company.");
  if (!account.data) return null;
  const company = companySchema.parse(account.data); const warnings: string[] = [];
  const records: GraphRecords = { companies: [company], people: [], drafts: [], touches: [], signals: [], jobs: [], posts: [], discoveries: [] };
  const requests = [
    { key: "people" as const, label: "Contacts", schema: personSchema.array(), request: db.from("people").select("id,account_id,full_name,title,email,email_status,do_not_contact").eq("account_id", company.id).order("created_at", { ascending: false }).limit(80) },
    { key: "drafts" as const, label: "Message cards", schema: draftSchema.array(), request: db.from("cards").select("id,account_id,person_id,signal_id,status,email_subject,email_body,brief,assigned_to,created_at").eq("account_id", company.id).order("created_at", { ascending: false }).limit(80) },
    { key: "signals" as const, label: "Research signals", schema: signalSchema.array(), request: db.from("signals").select("id,account_id,person_id,type,summary,source_url,observed_at").eq("account_id", company.id).order("found_at", { ascending: false }).limit(50) },
    { key: "jobs" as const, label: "Hiring inputs", schema: jobSchema.array(), request: db.from("job_postings").select("id,account_id,title,url,active,posted_at,family").eq("account_id", company.id).order("first_seen_at", { ascending: false }).limit(50) },
    { key: "posts" as const, label: "Employee posts", schema: postSchema.array(), request: db.from("public_posts").select("id,account_id,person_id,author_name,topic,excerpt,url,posted_at").eq("account_id", company.id).order("created_at", { ascending: false }).limit(40) },
    { key: "discoveries" as const, label: "Confirmed discoveries", schema: discoverySchema.array(), request: db.from("discovery_opportunities").select("id,company_domain,company_confirmed,status,owner,item").eq("company_confirmed", true).eq("company_domain", company.domain).order("checked_at", { ascending: false }).limit(40) },
  ];
  const results = await Promise.allSettled(requests.map(async (item) => {
    const result = await item.request;
    if (result.error) return { key: item.key, warning: `${item.label} could not be loaded. This layer is incomplete.` };
    const parsed = item.schema.safeParse(result.data ?? []);
    if (!parsed.success) return { key: item.key, warning: `${item.label} contained invalid records. This layer is incomplete.` };
    if ((result.data?.length ?? 0) === (item.key === "people" || item.key === "drafts" ? 80 : item.key === "signals" || item.key === "jobs" ? 50 : 40)) warnings.push(`${item.label} reached its display limit. Older records may be omitted.`);
    return { key: item.key, data: parsed.data };
  }));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") { warnings.push(`${requests[index].label} could not be loaded. This layer is incomplete.`); continue; }
    if (result.value.warning) { warnings.push(result.value.warning); continue; }
    const { key, data } = result.value;
    if (key === "people") records.people = personSchema.array().parse(data);
    else if (key === "drafts") records.drafts = draftSchema.array().parse(data);
    else if (key === "signals") records.signals = signalSchema.array().parse(data);
    else if (key === "jobs") records.jobs = jobSchema.array().parse(data);
    else if (key === "posts") records.posts = postSchema.array().parse(data);
    else records.discoveries = discoverySchema.array().parse(data);
  }
  if (records.drafts.length) {
    const result = await db.from("touches").select("id,card_id,person_id,channel,sent_at,sent_by,reply_at,reply_classification,bounced_at").in("card_id", records.drafts.map((draft) => draft.id)).order("created_at", { ascending: false }).limit(120);
    const parsed = touchSchema.array().safeParse(result.data ?? []);
    if (result.error || !parsed.success) warnings.push("Delivery and reply history could not be loaded. Those layers are incomplete.");
    else { records.touches = parsed.data; if (parsed.data.length === 120) warnings.push("Delivery history reached its display limit; older sends may be omitted."); }
  }
  return buildGraph(records, warnings, now);
}

type PageResult = { data: unknown[] | null; error: unknown };
export async function readPages(request: (from: number, to: number) => PromiseLike<PageResult>): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await request(offset, offset + 499);
    if (result.error) throw new Error("A relationship data page could not be loaded.");
    const page = result.data ?? []; rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export async function loadPortfolioGraph(db: SupabaseClient, now = Date.now()) {
  const companies = await loadMapCompanies(db);
  const warnings: string[] = [];
  async function read<T>(table: string, columns: string, schema: z.ZodType<T[]>) {
    try { return schema.parse(await readPages((from, to) => db.from(table).select(columns).order("id").range(from, to))); }
    catch { warnings.push(`${table}: records could not be fully loaded. This layer is incomplete.`); return []; }
  }
  const results = await Promise.allSettled([
    read("people", "id,account_id,full_name,title,email,email_status,do_not_contact", personSchema.array()),
    read("cards", "id,account_id,person_id,signal_id,status,email_subject,email_body,brief,assigned_to,created_at", draftSchema.array()),
    read("touches", "id,card_id,person_id,channel,sent_at,sent_by,reply_at,reply_classification,bounced_at", touchSchema.array()),
    read("signals", "id,account_id,person_id,type,summary,source_url,observed_at", signalSchema.array()),
    read("job_postings", "id,account_id,title,url,active,posted_at,family", jobSchema.array()),
    read("public_posts", "id,account_id,person_id,author_name,topic,excerpt,url,posted_at", postSchema.array()),
    read("discovery_opportunities", "id,company_domain,company_confirmed,status,owner,item", discoverySchema.array()),
  ]);
  function result<T>(index: number, schema: z.ZodType<T[]>) { const entry = results[index]; return entry.status === "fulfilled" ? schema.parse(entry.value) : []; }
  return { companies, graph: buildGraph({ companies, people: result(0, personSchema.array()), drafts: result(1, draftSchema.array()), touches: result(2, touchSchema.array()), signals: result(3, signalSchema.array()), jobs: result(4, jobSchema.array()), posts: result(5, postSchema.array()), discoveries: result(6, discoverySchema.array()) }, warnings, now) };
}
