import { researchAddress } from "./address-research.ts";
import { addressCheck, rejectedAddresses } from "./address-history.ts";
import { checkRecipient, recordRecipientCheck } from "./recipient-verification.ts";
import { reopenBouncedCards } from "./nightly-list-builder.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findAddress, type FinderDeps } from "./address-finder.ts";
import { addressesToWork, importAddressEvidence } from "./nightly-list-builder.ts";
import { domainAcceptsMail } from "./recipient-verification.ts";

type Db = SupabaseClient;
/** A person is searched again after a week: sites change, and new pages get published. */
const RESEARCH_AFTER_MS = 7 * 86_400_000;

const BOUNCE_RESEARCH_AFTER_MS = 86_400_000;

export type SweepOutcome = { personId: string; name: string; domain: string; result: string };

/**
 * Work the unconfirmed addresses a few at a time: bounced people first, then Suuchi's, then Josh's. Each
 * search reads the company's own site; what it finds goes through importAddressEvidence, the same check the
 * address routine's evidence gets. A domain that takes no mail marks the guess bad, so it is never sent.
 */
export async function runAddressSweep(db: Db, options: { now?: Date; limit?: number; budgetMs?: number; deps?: FinderDeps } = {}): Promise<SweepOutcome[]> {
  const now = options.now ?? new Date();
  const started = Date.now();
  const deps: FinderDeps = { mailHost: domainAcceptsMail, signal: AbortSignal.timeout(options.budgetMs ?? 200_000), ...options.deps };
  const people = (await addressesToWork(db)).filter((person) => person.domain && person.name);
  const ids = people.map((person) => person.personId);
  const { data: checks, error: checksError } = ids.length ? await db.from("people").select("id,email,email_status,email_source,email_verified_at,email_check,full_name").in("id", ids) : { data: [], error: null };
  if (checksError) throw new Error("Could not read address research history.");
  const saved = new Map(((checks ?? []) as Array<{ id: string; full_name: string; email: string | null; email_status: string; email_check: unknown; email_source?: string; email_verified_at?: string }>).map((row) => [row.id, row]));
  const lastSearch = (id: string) => Date.parse(String(addressCheck(saved.get(id)?.email_check).searchedAt ?? "")) || 0;
  const failures = (id: string) => rejectedAddresses(saved.get(id) ?? {});
  const rank = (person: (typeof people)[number]) => failures(person.personId).length || person.emailStatus === "invalid" ? 0 : person.owner === "suuchi" ? 1 : 2;
  const due = people.filter((person) => {
    const check = addressCheck(saved.get(person.personId)?.email_check);
    const bounced = Date.parse(String(check.bouncedAt ?? (person.emailStatus === "invalid" ? check.checkedAt : ""))) || 0;
    return bounced > lastSearch(person.personId) || now.getTime() - lastSearch(person.personId) >= (rank(person) === 0 ? BOUNCE_RESEARCH_AFTER_MS : RESEARCH_AFTER_MS);
  }).filter((person, index, all) => all.findIndex((other) => other.personId === person.personId) === index)
    .sort((a, b) => rank(a) - rank(b) || lastSearch(a.personId) - lastSearch(b.personId));
  const out: SweepOutcome[] = [];
  for (const person of due.slice(0, options.limit ?? 8)) {
    if (Date.now() - started > (options.budgetMs ?? 200_000)) break;
    const record = (result: string) => out.push({ personId: person.personId, name: person.name, domain: person.domain, result });
    try {
      const contact = saved.get(person.personId);
      if (contact?.email && contact.email_status !== "invalid") {
        const check = await checkRecipient(db, { ...contact, full_name: person.name }, { id: "", domain: person.domain }, { force: true });
        await recordRecipientCheck(db, contact, check);
        if (check.level === "deliverable") {
          await reopenBouncedCards(db, person.personId);
          record(`verified: ${contact.email}`);
          continue;
        }
      }
      let found = await findAddress({ name: person.name, domain: person.domain, avoid: person.emailStatus === "invalid" ? person.email : null, rejected: failures(person.personId) }, deps);
      if (found.kind !== "evidence" && failures(person.personId).length && process.env.ANTHROPIC_API_KEY?.trim()) {
        const research = await researchAddress({ name: person.name, company: person.company, domain: person.domain, rejected: failures(person.personId) }, deps.signal);
        const { data: latest } = await db.from("people").select("email_check").eq("id", person.personId).maybeSingle();
        const savedResearch = await db.from("people").update({ email_check: { ...addressCheck(latest?.email_check), researchSourceDate: research.sourceDate, researchCostUsd: research.costUsd, researchedEvidence: research.evidence } }).eq("id", person.personId);
        if (savedResearch.error) throw new Error(savedResearch.error.message);
        if (research.evidence) found = { kind: "evidence", evidence: research.evidence };
      }
      if (found.kind === "evidence") {
        const [outcome] = await importAddressEvidence(db, [{ personId: person.personId, domain: person.domain, name: person.name, emailEvidence: found.evidence }], deps);
        record(`${outcome.outcome}: ${outcome.address} (${outcome.reason})`);

      } else if (found.kind === "no-mail" && (!person.email || person.email.split("@")[1] === person.domain)) {
        await db.from("people").update({ email_status: "invalid", email_check: { ...addressCheck(saved.get(person.personId)?.email_check), email: person.email, level: "undeliverable", status: "invalid", source: "finder", reason: `${person.domain} does not accept email.`, checkedAt: now.toISOString(), searchedAt: now.toISOString() } }).eq("id", person.personId);
        record(`bad: ${person.domain} does not accept email`);
        continue;
      } else record(found.kind === "none" ? `nothing found (${found.pagesRead} pages, ${found.addressesSeen} addresses seen)` : "Website domain has no mail; alternate mailbox still needs verification");
      // Remember the search without losing what the address check already knows.
      const { data: current } = await db.from("people").select("email_check").eq("id", person.personId).maybeSingle();
      const check = (current?.email_check && typeof current.email_check === "object" ? current.email_check : {}) as Record<string, unknown>;
      await db.from("people").update({ email_check: { ...check, researchOutcome: out[out.length - 1]?.result, searchedAt: now.toISOString() } }).eq("id", person.personId);
    } catch (error) {
      record(`failed: ${error instanceof Error ? error.message : "search failed"}`);
      const { data: latest } = await db.from("people").select("email_check").eq("id", person.personId).maybeSingle();
      await db.from("people").update({ email_check: { ...addressCheck(latest?.email_check), searchedAt: now.toISOString(), researchOutcome: out[out.length - 1]?.result } }).eq("id", person.personId);
    }
  }
  return out;
}
