import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser, requireActualUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { configSchema, opportunitySchema, patchSchema } from "@/lib/discovery/domain";
import { runDiscovery } from "@/lib/discovery/run";
import { check } from "@/lib/discovery/store";
import { screenDomains } from "@/lib/nightly-list-builder";
export const maxDuration = 300;
const id = z.string().regex(/^[a-f0-9]{64}$/);
const input = z.discriminatedUnion("action", [z.object({ action: z.literal("run") }), z.object({ action: z.literal("configure"), config: configSchema }), z.object({ action: z.literal("update"), id, patch: patchSchema }), z.object({ action: z.literal("queue"), id, version: z.number().int().positive() }), z.object({ action: z.literal("delete"), id, version: z.number().int().positive() })]);
export async function POST(request: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const action = parsed.data;
  if (["run", "configure", "queue"].includes(action.action) && (await requireActualUser()).role !== "admin") return Response.json({ error: "Admins configure discovery and queue company research." }, { status: 403 });
  try {
    const db = admin();
    if (action.action === "run") return Response.json(await runDiscovery(db, `manual:${randomUUID()}`));
    if (action.action === "configure") { check((await db.from("discovery_config").upsert({ id: true, config: action.config, updated_at: new Date().toISOString() })).error); return Response.json({ saved: true }); }
    const result = await db.from("discovery_opportunities").select("*").eq("id", action.id).single(); check(result.error);
    const row = opportunitySchema.parse(result.data);
    if (row.owner && row.owner !== user.owner && user.role !== "admin") return Response.json({ error: "The other seat owns this opportunity." }, { status: 403 });
    const version = action.action === "update" ? action.patch.version : action.version;
    if (version !== row.version) return Response.json({ error: "Opportunity changed. Refresh first." }, { status: 409 });
    if (action.action === "queue") {
      if (!row.company_confirmed || !row.company_domain || !row.company_name || !row.company_evidence_url || !row.owner) return Response.json({ error: "Confirm the business name, domain and supporting source, then assign an owner before queuing research." }, { status: 400 });
      if (!row.item.active || row.status === "dismissed" || row.feedback === "irrelevant" || (row.item.deadline && Date.parse(row.item.deadline) <= Date.now())) return Response.json({ error: "This opportunity is inactive, expired or dismissed." }, { status: 400 });
      if (!row.promoted_candidate_id) { const [screen] = await screenDomains(db, [row.company_domain]); if (!screen?.usable) return Response.json({ error: screen?.reason ?? "Company is already handled or excluded." }, { status: 409 }); }
      const queued = await db.rpc("queue_discovery_company", { p_id: row.id, p_version: version, p_actor: user.email }); check(queued.error);
      return Response.json({ candidate_id: queued.data, note: "Company queued for existing fit and contact research. No contact was created or email sent." });
    }
    if (action.action === "delete") { const removed = await db.from("discovery_opportunities").delete().eq("id", row.id).eq("version", version).select("id"); check(removed.error); return removed.data?.length ? Response.json({ deleted: true }) : Response.json({ error: "Opportunity changed. Refresh first." }, { status: 409 }); }
    const { version: _version, ...patch } = action.patch; void _version;
    if (patch.status === "research_queued" && row.status !== "research_queued") return Response.json({ error: "Use Queue company research to enter this stage." }, { status: 400 });
    if (patch.owner && patch.owner !== user.owner && user.role !== "admin") return Response.json({ error: "You can claim only your own seat." }, { status: 403 });
    const nextStatus = patch.status ?? row.status;
    const nextOwner = patch.owner !== undefined ? patch.owner : row.owner;
    if (["research_queued", "engaged", "qualified", "meeting"].includes(nextStatus) && !nextOwner) return Response.json({ error: "Assign one owner before engaging." }, { status: 400 });
    const companyChanged = (patch.company_domain !== undefined && patch.company_domain !== row.company_domain) || (patch.company_name !== undefined && patch.company_name !== row.company_name) || (patch.company_evidence_url !== undefined && patch.company_evidence_url !== row.company_evidence_url);
    if (row.promoted_candidate_id && companyChanged) return Response.json({ error: "Company research is already queued. Its company identity cannot be changed here." }, { status: 409 });
    if (companyChanged && patch.company_confirmed !== true) patch.company_confirmed = false;
    const nextName = patch.company_name !== undefined ? patch.company_name : row.company_name;
    const nextDomain = patch.company_domain !== undefined ? patch.company_domain : row.company_domain;
    const nextEvidence = patch.company_evidence_url !== undefined ? patch.company_evidence_url : row.company_evidence_url;
    if (patch.company_confirmed && (!nextName || !nextDomain || !nextEvidence)) return Response.json({ error: "Company confirmation needs a business name, domain and supporting source." }, { status: 400 });
    const saved = await db.rpc("review_discovery", { p_id: row.id, p_version: version, p_patch: patch, p_actor: user.email }); check(saved.error);
    return saved.data ? Response.json({ saved: true }) : Response.json({ error: "Opportunity changed. Refresh first." }, { status: 409 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not save discovery work." }, { status: 500 }); }
}
