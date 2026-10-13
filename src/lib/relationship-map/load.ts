import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildGraph, type Company, type GraphRecords } from "./graph.ts";
const optionalText = z.string().nullable().optional().transform((value) => value ?? null);
const companySchema = z.object({ id: z.string(), name: z.string(), domain: z.string(), status: z.string(), outreach_stage: optionalText, outreach_owner: optionalText, vertical: optionalText, employee_range: optionalText });
const personSchema = z.object({ id: z.string(), account_id: z.string(), full_name: z.string(), title: z.string(), email: optionalText, email_status: z.string(), do_not_contact: z.boolean(), email_source: optionalText, email_verified_at: optionalText, created_at: optionalText, linkedin_url: optionalText });
const draftSchema = z.object({ id: z.string(), account_id: z.string(), person_id: optionalText, signal_id: optionalText, status: z.string(), email_subject: optionalText, email_body: optionalText, brief: optionalText, assigned_to: z.string(), created_at: z.string() });
const touchSchema = z.object({ id: z.string(), card_id: z.string(), person_id: z.string(), channel: z.string(), sent_at: optionalText, sent_by: z.string(), reply_at: optionalText, reply_classification: optionalText, bounced_at: optionalText });
const signalSchema = z.object({ id: z.string(), account_id: z.string(), person_id: optionalText, type: z.string(), summary: z.string(), source_url: z.string(), observed_at: optionalText });
const jobSchema = z.object({ id: z.string(), account_id: z.string(), title: z.string(), url: z.string(), active: z.boolean(), posted_at: optionalText, family: optionalText });
const postSchema = z.object({ id: z.string(), account_id: z.string(), person_id: optionalText, author_name: z.string(), topic: z.string(), excerpt: optionalText, url: z.string(), posted_at: optionalText });
const discoverySchema = z.object({ id: z.string(), company_domain: optionalText, company_confirmed: z.boolean(), status: z.string(), owner: optionalText, item: z.object({ title: z.string(), text: z.string(), url: z.string(), provider: z.string(), published_at: optionalText, active: z.boolean() }) });
export async function loadMapCompanies(db: SupabaseClient, query = "", domains?: string[]) {
  if (domains && !domains.length) return [];
  const safe = query.trim().replace(/[%,()*]/g, " ").slice(0, 80);
  const rows = await readPages((from, to) => { let request = db.from("accounts").select("id,name,domain,status,outreach_stage,outreach_owner,vertical,employee_range").not("domain", "like", "%.example"); if (domains) request = request.in("domain", domains); if (safe) request = request.or(`name.ilike.%${safe}%,domain.ilike.%${safe}%`); return request.order("id").range(from, to); });
  return companySchema.array().parse(rows);

}
export async function loadRelationshipGraph(db: SupabaseClient, domain: string, now = Date.now()) {
  const account = await db.from("accounts").select("id,name,domain,status,outreach_stage,outreach_owner,vertical,employee_range").eq("domain", domain).maybeSingle();
  if (account.error) throw new Error("Could not load this company.");
  if (!account.data) return null;
  const company = companySchema.parse(account.data); const warnings: string[] = [];
  async function read<T>(label: string, request: (from: number, to: number) => PromiseLike<PageResult>, schema: z.ZodType<T[]>) {
    try { return schema.parse(await readPages(request)); }
    catch { warnings.push(`${label} could not be loaded. This layer is incomplete.`); return []; }
  }
  const [people, drafts, signals, jobs, posts, discoveries] = await Promise.all([
    read("Contacts", (from, to) => db.from("people").select("id,account_id,full_name,title,email,email_status,do_not_contact,email_source,email_verified_at,created_at,linkedin_url").eq("account_id", company.id).order("id").range(from, to), personSchema.array()),
    read("Message cards", (from, to) => db.from("cards").select("id,account_id,person_id,signal_id,status,email_subject,email_body,brief,assigned_to,created_at").eq("account_id", company.id).order("id").range(from, to), draftSchema.array()),
    read("Research signals", (from, to) => db.from("signals").select("id,account_id,person_id,type,summary,source_url,observed_at").eq("account_id", company.id).order("id").range(from, to), signalSchema.array()),
    read("Hiring inputs", (from, to) => db.from("job_postings").select("id,account_id,title,url,active,posted_at,family").eq("account_id", company.id).order("id").range(from, to), jobSchema.array()),
    read("Employee posts", (from, to) => db.from("public_posts").select("id,account_id,person_id,author_name,topic,excerpt,url,posted_at").eq("account_id", company.id).order("id").range(from, to), postSchema.array()),
    read("Confirmed discoveries", (from, to) => db.from("discovery_opportunities").select("id,company_domain,company_confirmed,status,owner,item").eq("company_confirmed", true).eq("company_domain", company.domain).order("id").range(from, to), discoverySchema.array()),
  ]);
  const touches: GraphRecords["touches"] = [];
  for (let offset = 0; offset < drafts.length; offset += 100) {
    const ids = drafts.slice(offset, offset + 100).map((draft) => draft.id);
    touches.push(...await read("Delivery and reply history", (from, to) => db.from("touches").select("id,card_id,person_id,channel,sent_at,sent_by,reply_at,reply_classification,bounced_at").in("card_id", ids).order("id").range(from, to), touchSchema.array()));
  }
  return buildGraph({ companies: [company], people, drafts, touches, signals, jobs, posts, discoveries }, warnings, now);
}

type PageResult = { data: unknown[] | null; error: unknown };
export async function readPages(request: (from: number, to: number) => PromiseLike<PageResult>): Promise<unknown[]> {
  const rows: unknown[] = [];
  const first = await request(0, 499);
  if (first.error) throw new Error("A relationship data page could not be loaded.");
  rows.push(...first.data ?? []);
  if ((first.data?.length ?? 0) < 500) return rows;
  for (let offset = 500; ; offset += 2000) {
    const pages = await Promise.all([0, 1, 2, 3].map((index) => request(offset + index * 500, offset + index * 500 + 499)));
    for (const result of pages) {
      if (result.error) throw new Error("A relationship data page could not be loaded.");
      const page = result.data ?? []; rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
}
export async function loadPortfolioGraph(db: SupabaseClient, now = Date.now(), scopedCompanies?: Company[]) {
  const companies = scopedCompanies ?? await loadMapCompanies(db);
  const warnings: string[] = [];
  async function read<T>(table: string, columns: string, schema: z.ZodType<T[]>, cardIds: string[] = []) {
    const scope = scopedCompanies ? table === "touches" ? cardIds : table === "discovery_opportunities" ? companies.map((company) => company.domain) : companies.map((company) => company.id) : null;
    const field = table === "touches" ? "card_id" : table === "discovery_opportunities" ? "company_domain" : "account_id";
    try {
      if (scope && !scope.length) return [];
      const rows: unknown[] = [];
      for (let offset = 0; offset < (scope?.length ?? 1); offset += 100) rows.push(...await readPages((from, to) => { let request = db.from(table).select(columns); if (scope) request = request.in(field, scope.slice(offset, offset + 100)); return request.order("id").range(from, to); }));
      return schema.parse(rows);
    }
    catch { warnings.push(`${table}: records could not be fully loaded. This layer is incomplete.`); return []; }
  }
  const results = await Promise.allSettled([
    read("people", "id,account_id,full_name,title,email,email_status,do_not_contact,email_source,email_verified_at,created_at,linkedin_url", personSchema.array()),
    read("cards", "id,account_id,person_id,signal_id,status,email_subject,email_body,brief,assigned_to,created_at", draftSchema.array()),
    scopedCompanies ? Promise.resolve([]) : read("touches", "id,card_id,person_id,channel,sent_at,sent_by,reply_at,reply_classification,bounced_at", touchSchema.array()),
    read("signals", "id,account_id,person_id,type,summary,source_url,observed_at", signalSchema.array()),
    read("job_postings", "id,account_id,title,url,active,posted_at,family", jobSchema.array()),
    read("public_posts", "id,account_id,person_id,author_name,topic,excerpt,url,posted_at", postSchema.array()),
    read("discovery_opportunities", "id,company_domain,company_confirmed,status,owner,item", discoverySchema.array()),
  ]);
  function result<T>(index: number, schema: z.ZodType<T[]>) { const entry = results[index]; return entry.status === "fulfilled" ? schema.parse(entry.value) : []; }
  const touches = scopedCompanies ? await read("touches", "id,card_id,person_id,channel,sent_at,sent_by,reply_at,reply_classification,bounced_at", touchSchema.array(), result(1, draftSchema.array()).map((draft) => draft.id)) : result(2, touchSchema.array());
  return { companies, graph: buildGraph({ companies, people: result(0, personSchema.array()), drafts: result(1, draftSchema.array()), touches, signals: result(3, signalSchema.array()), jobs: result(4, jobSchema.array()), posts: result(5, postSchema.array()), discoveries: result(6, discoverySchema.array()) }, warnings, now) };
}
