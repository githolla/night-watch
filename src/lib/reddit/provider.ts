import { z } from "zod";
import { accessState, sourceSchema, type RedditSource } from "./domain.ts";

const listingSchema = z.object({ data: z.object({ after: z.string().nullable().optional(), children: z.array(z.object({ kind: z.string(), data: z.record(z.string(), z.unknown()) })) }) });
function string(value: unknown) { return typeof value === "string" ? value : ""; }
export function parsePost(data: Record<string, unknown>): RedditSource {
  const id = string(data.id);
  const permalink = string(data.permalink);
  if (!/^[a-z0-9]+$/.test(id) || !new RegExp(`^/r/[A-Za-z0-9_]+/comments/${id}/`).test(permalink)) throw new Error("Invalid Reddit permalink.");
  const text = string(data.selftext);
  return sourceSchema.parse({ id, subreddit: string(data.subreddit), permalink: `https://www.reddit.com${permalink}`, title: string(data.title).slice(0, 1000), text: text.slice(0, 16000), created_at: new Date(Number(data.created_utc) * 1000).toISOString(), locked: data.locked === true || data.archived === true, deleted: text === "[removed]" || text === "[deleted]" || data.author === "[deleted]" || data.removed_by_category != null, comments: [], comments_partial: text.length > 16000 });
}
export function parseComments(value: unknown): { comments: RedditSource["comments"]; partial: boolean } {
  const comments: RedditSource["comments"] = [];
  let partial = false;
  function visit(list: unknown) {
    const parsed = listingSchema.safeParse(list);
    if (!parsed.success) throw new Error("Malformed Reddit comments response.");
    for (const child of parsed.data.data.children) {
      if (child.kind === "more") { partial = true; continue; }
      if (child.kind !== "t1") continue;
      const text = string(child.data.body);
      if (text.length > 3000) partial = true;
      if (text && text !== "[deleted]" && text !== "[removed]" && child.data.author !== "[deleted]") {
        if (comments.length < 40) comments.push({ id: string(child.data.id), text: text.slice(0, 3000), is_author: child.data.is_submitter === true });
        else partial = true;
      }
      if (child.data.replies && typeof child.data.replies === "object") visit(child.data.replies);
    }
  }
  visit(value);
  return { comments, partial };
}
export class RedditProvider {
  private token = "";
  requests = 0;
  private remaining = Infinity;
  private signal: AbortSignal;
  private fetcher: typeof fetch;
  private env: Record<string, string | undefined>;
  constructor(signal: AbortSignal, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env) {
    this.signal = signal; this.fetcher = fetcher; this.env = env;
  }
  private async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    if (!accessState(this.env).ready) throw new Error("Approved Reddit access is not configured.");
    if (this.remaining < 2 || this.requests >= 35) throw new Error("Reddit request allowance reached; coverage is partial.");
    if (!this.token) {
      const response = await this.fetcher("https://www.reddit.com/api/v1/access_token", { method: "POST", redirect: "error", signal: AbortSignal.any([this.signal, AbortSignal.timeout(12000)]), headers: { Authorization: `Basic ${Buffer.from(`${this.env.REDDIT_CLIENT_ID}:${this.env.REDDIT_CLIENT_SECRET}`).toString("base64")}`, "User-Agent": this.env.REDDIT_USER_AGENT!, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.env.REDDIT_REFRESH_TOKEN! }) });
      if (!response.ok) throw new Error(`Reddit token request failed (${response.status}).`);
      const token = z.object({ access_token: z.string().min(1), scope: z.string() }).parse(await response.json());
      if (!token.scope.split(" ").includes("read")) throw new Error("Approved Reddit token lacks read scope.");
      this.token = token.access_token;
    }
    const url = new URL(path, "https://oauth.reddit.com");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    this.requests++;
    const response = await this.fetcher(url, { redirect: "error", signal: AbortSignal.any([this.signal, AbortSignal.timeout(12000)]), headers: { Authorization: `Bearer ${this.token}`, "User-Agent": this.env.REDDIT_USER_AGENT! }, cache: "no-store" });
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining !== null && Number.isFinite(Number(remaining))) this.remaining = Number(remaining);
    if (!response.ok) throw new Error(`Reddit read failed (${response.status}); no fallback scraping attempted.`);
    return response.json();
  }
  async search(query: string, communities: string[], since: number) {
    if (!communities.length || communities.some((name) => !/^[A-Za-z0-9_]{2,30}$/.test(name))) throw new Error("Choose valid communities first.");
    const rows: RedditSource[] = [];
    let after: string | undefined;
    for (let page = 0; page < 2; page++) {
      const listing = listingSchema.parse(await this.get(`/r/${communities.join("+")}/search`, { q: query, restrict_sr: "on", sort: "new", t: "week", limit: "50", ...(after ? { after } : {}) }));
      let older = false;
      for (const child of listing.data.children) if (child.kind === "t3") {
        const row = parsePost(child.data);
        if (Date.parse(row.created_at) < since) older = true;
        else if (!row.deleted && communities.some((name) => name.toLowerCase() === row.subreddit.toLowerCase())) rows.push(row);
      }
      after = listing.data.after ?? undefined;
      if (!after || older) return { rows, partial: false };
    }
    return { rows, partial: Boolean(after) };
  }
  async thread(id: string) {
    if (!/^[a-z0-9]+$/.test(id)) throw new Error("Invalid thread ID.");
    const value = await this.get(`/comments/${id}`, { limit: "50", depth: "4", sort: "new", raw_json: "1" });
    if (!Array.isArray(value) || value.length < 2) throw new Error("Malformed Reddit thread response.");
    const posts = listingSchema.parse(value[0]);
    const post = posts.data.children.find((child) => child.kind === "t3");
    if (!post) throw new Error("Thread unavailable; content must be purged.");
    const source = parsePost(post.data);
    const comments = parseComments(value[1]);
    return { ...source, comments: comments.comments, comments_partial: source.comments_partial || comments.partial };
  }
  async rules(name: string) {
    if (!/^[A-Za-z0-9_]{2,30}$/.test(name)) throw new Error("Invalid community.");
    const rules = z.object({ rules: z.array(z.object({ short_name: z.string(), description: z.string() })) }).parse(await this.get(`/r/${name}/about/rules`));
    return rules.rules.map((rule) => `${rule.short_name}: ${rule.description}`).join("\n").slice(0, 12000);
  }
}
