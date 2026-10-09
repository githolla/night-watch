import type { SupabaseClient } from "@supabase/supabase-js";
import { findAddress, type FinderDeps } from "./address-finder.ts";
import { addressesToWork, importAddressEvidence } from "./nightly-list-builder.ts";
import { domainAcceptsMail } from "./recipient-verification.ts";

type Db = SupabaseClient;
/** A person is searched again after a week: sites change, and new pages get published. */
const RESEARCH_AFTER_MS = 7 * 86_400_000;

export type SweepOutcome = { personId: string; name: string; domain: string; result: string };

/**
 * Work the unconfirmed addresses a few at a time: bounced people first, then Suuchi's, then Josh's. Each
 * search reads the company's own site; what it finds goes through importAddressEvidence, the same check the
 * address routine's evidence gets. A domain that takes no mail marks the guess bad, so it is never sent.
 */
export async function runAddressSweep(db: Db, options: { now?: Date; limit?: number; budgetMs?: number; deps?: FinderDeps } = {}): Promise<SweepOutcome[]> {
  const now = options.now ?? new Date();
  const started = Date.now();
  const deps: FinderDeps = { mailHost: domainAcceptsMail, ...options.deps };
  const people = (await addressesToWork(db)).filter((person) => person.domain && person.name);
  const ids = people.map((person) => person.personId);
  const { data: checks } = ids.length ? await db.from("people").select("id,email_check").in("id", ids) : { data: [] };
  const searchedAt = new Map(((checks ?? []) as Array<{ id: string; email_check: { searchedAt?: string } | null }>).map((row) => [row.id, row.email_check?.searchedAt ? Date.parse(row.email_check.searchedAt) : 0]));
  const rank = (person: (typeof people)[number]) => (person.emailStatus === "invalid" ? 0 : person.owner === "suuchi" ? 1 : 2);
  const due = people.filter((person) => now.getTime() - (searchedAt.get(person.personId) ?? 0) > RESEARCH_AFTER_MS)
    .filter((person, index, all) => all.findIndex((other) => other.personId === person.personId) === index)
    .sort((a, b) => rank(a) - rank(b));
  const out: SweepOutcome[] = [];
  for (const person of due.slice(0, options.limit ?? 8)) {
    if (Date.now() - started > (options.budgetMs ?? 200_000)) break;
    const record = (result: string) => out.push({ personId: person.personId, name: person.name, domain: person.domain, result });
    try {
      const found = await findAddress({ name: person.name, domain: person.domain, avoid: person.emailStatus === "invalid" ? person.email : null }, deps);
      if (found.kind === "evidence") {
        const [outcome] = await importAddressEvidence(db, [{ personId: person.personId, domain: person.domain, name: person.name, emailEvidence: found.evidence }], deps);
        record(`${outcome.outcome}: ${outcome.address} (${outcome.reason})`);
        if (outcome.outcome !== "unconfirmed") continue;
      } else if (found.kind === "no-mail") {
        await db.from("people").update({ email_status: "invalid", email_check: { email: person.email, level: "undeliverable", status: "invalid", source: "finder", reason: `${person.domain} does not accept email.`, checkedAt: now.toISOString(), searchedAt: now.toISOString() } }).eq("id", person.personId);
        record(`bad: ${person.domain} does not accept email`);
        continue;
      } else record(`nothing found (${found.pagesRead} pages, ${found.addressesSeen} addresses seen)`);
      // Remember the search without losing what the address check already knows.
      const { data: current } = await db.from("people").select("email_check").eq("id", person.personId).maybeSingle();
      const check = (current?.email_check && typeof current.email_check === "object" ? current.email_check : {}) as Record<string, unknown>;
      await db.from("people").update({ email_check: { ...check, searchedAt: now.toISOString() } }).eq("id", person.personId);
    } catch (error) { record(`failed: ${error instanceof Error ? error.message : "search failed"}`); }
  }
  return out;
}
