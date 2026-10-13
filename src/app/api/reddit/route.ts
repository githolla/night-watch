import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser, requireActualUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { configSchema, opportunitySchema, patchSchema } from "@/lib/reddit/domain";
import { loadConfig, check } from "@/lib/reddit/store";
import { runReddit } from "@/lib/reddit/run";
import { RedditProvider } from "@/lib/reddit/provider";
import { draftResponse } from "@/lib/reddit/analysis";
import { researchBudget, withBudget } from "@/lib/anthropic-cost";
export const maxDuration = 300;
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), config: configSchema }),
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("rules"), name: z.string().regex(/^[A-Za-z0-9_]{2,30}$/) }),
  z.object({ action: z.literal("update"), id: z.string().regex(/^[a-z0-9]+$/), patch: patchSchema }),
  z.object({ action: z.literal("draft"), id: z.string().regex(/^[a-z0-9]+$/), version: z.number().int() }),
  z.object({ action: z.literal("delete"), id: z.string().regex(/^[a-z0-9]+$/), version: z.number().int() }),
]);
export async function POST(request: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid discovery request." }, { status: 400 });
  const action = parsed.data;
  if (["configure", "run", "rules", "draft"].includes(action.action)) {
    const actual = await requireActualUser();
    if (actual.role !== "admin") return Response.json({ error: "An admin must configure or spend discovery budget." }, { status: 403 });
  }
  try {
    const db = admin();
    if (action.action === "configure") {
      if (new Set(action.config.queries.map((query) => query.id)).size !== action.config.queries.length || new Set(action.config.communities.map((community) => community.name.toLowerCase())).size !== action.config.communities.length) return Response.json({ error: "Community names and query IDs must be unique." }, { status: 400 });
      check((await db.from("reddit_config").upsert({ id: true, config: action.config, updated_at: new Date().toISOString() })).error);
      return Response.json({ saved: true });
    }
    if (action.action === "run") return Response.json(await runReddit(db, `manual:${randomUUID()}`));
    if (action.action === "rules") return Response.json({ rules: await new RedditProvider(AbortSignal.timeout(30000)).rules(action.name), checked_at: new Date().toISOString() });
    const result = await db.from("reddit_opportunities").select("*").eq("id", action.id).single();
    check(result.error);
    const row = opportunitySchema.parse(result.data);
    if (row.owner && row.owner !== user.owner && user.role !== "admin") return Response.json({ error: "This conversation belongs to the other seat." }, { status: 403 });
    const expectedVersion = action.action === "update" ? action.patch.version : action.version;
    if (row.version !== expectedVersion) return Response.json({ error: "Conversation changed. Refresh first." }, { status: 409 });
    if (action.action === "delete") {
      const deleted = await db.from("reddit_opportunities").delete().eq("id", action.id).eq("version", action.version).select("id"); check(deleted.error);
      return deleted.data?.length ? Response.json({ deleted: true }) : Response.json({ error: "Conversation changed. Refresh first." }, { status: 409 });
    }
    if (action.action === "update" && action.patch.owner && action.patch.owner !== user.owner && user.role !== "admin") return Response.json({ error: "You can claim a conversation for your own seat." }, { status: 403 });
    let patch: Record<string, unknown>;
    let cost = 0;
    if (action.action === "draft") {
      if (!row.analysis) throw new Error("This thread needs analysis before drafting.");
      const config = await loadConfig(db);
      const community = config.communities.find((item) => item.name.toLowerCase() === row.source.subreddit.toLowerCase());
      const signal = AbortSignal.timeout(150000);
      const source = await new RedditProvider(signal).thread(row.id);
      if (source.deleted || JSON.stringify(source) !== JSON.stringify(row.source)) {
        if (source.deleted) check((await db.from("reddit_opportunities").delete().eq("id", row.id)).error);
        else check((await db.from("reddit_opportunities").update({ source, version: row.version + 1, analysis: null, draft: null, changed_at: new Date().toISOString(), checked_at: new Date().toISOString() }).eq("id", row.id).eq("version", row.version)).error);
        return Response.json({ error: "Thread changed. Refresh its analysis before drafting." }, { status: 409 });
      }
      const usage = withBudget((value) => { cost += value; }, researchBudget(0, config.cost_cap_usd));
      patch = { draft: await draftResponse(source, row.analysis, community, signal, usage) };
    } else {
      const { version: _version, ...changes } = action.patch;
      void _version;
      const nextOwner = changes.owner !== undefined ? changes.owner : row.owner;
      const nextStatus = changes.status ?? row.status;
      const nextContact = changes.contact !== undefined ? changes.contact : row.contact;
      if (["engaged", "responded", "contact_shared", "qualified", "meeting"].includes(nextStatus) && !nextOwner) return Response.json({ error: "Assign one owner before engaging." }, { status: 400 });
      if (["contact_shared", "qualified", "meeting"].includes(nextStatus) && !nextContact) return Response.json({ error: "Record voluntarily shared contact details and the consent evidence first." }, { status: 400 });
      patch = changes;
    }
    const version = action.action === "draft" ? action.version : action.patch.version;
    const saved = await db.rpc("update_reddit_opportunity", { p_id: row.id, p_version: version, p_patch: patch, p_actor: user.email });
    check(saved.error);
    if (!saved.data) return Response.json({ error: "Conversation changed. Refresh first." }, { status: 409 });
    return Response.json({ saved: true, cost_usd: cost });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not save discovery work." }, { status: 500 }); }
}
