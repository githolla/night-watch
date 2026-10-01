import { promises as dns } from "node:dns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEmail, detectPattern } from "./email-pattern.ts";
import { verifierConfigured, verifyEmail, type VerifyResult } from "./email-verify.ts";
import { focusedContacts } from "./focused-contact.ts";

/**
 * Can this address receive mail? The list contacts are researched, not verified (inferred from the
 * company's format or published on the web), so a strict "verified only" rule would block every list send
 * while no rule at all lets a wrong guess bounce and hurt the domain.
 *
 * Order: what we already know (a bounce, a verification, an earlier delivery), then Hunter, then our own
 * checks for whatever Hunter cannot answer (no key, quota, "unknown", accept-all): the domain must accept
 * mail, and the address is compared with the format proven by real addresses at the company. Bounces feed
 * back in through markBounced, so the system learns from its own sends.
 *
 * Manual sends are blocked only when the address is known bad. Automatic sends (no human click) need it
 * to be known good.
 */
export type RecipientLevel = "deliverable" | "risky" | "undeliverable";
export type RecipientCheck = {
  email: string;
  level: RecipientLevel;
  reason: string;
  source: "history" | "hunter" | "own";
  status: "verified" | "catch_all" | "unverified" | "invalid";
  suggestion: string | null;
  hunter: string | null;
  mailHost: boolean | null;
  checkedAt: string;
};

export type RecipientPerson = { id: string; full_name: string; email: string | null; email_status: string; email_source?: string | null; email_verified_at?: string | null; email_check?: unknown };
export type RecipientAccount = { id: string; domain: string };

type MailHostLookup = (domain: string) => Promise<boolean | null>;
type Deps = { mailHost?: MailHostLookup; hunter?: (email: string) => Promise<VerifyResult>; now?: () => number };

const DAY = 86_400_000;
const CACHE_MS = 7 * DAY;
const VERIFIED_MS = 180 * DAY;
const BOUNCE_WINDOW_MS = 60 * 60_000;
const SYNTAX = /^[^\s@<>"(),;:\\[\]]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

type Stored = Partial<RecipientCheck> & { lastSentEmail?: string; lastSentAt?: string; bouncedEmail?: string };
function stored(value: unknown): Stored {
  let parsed: unknown = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { return {}; } }
  return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
}

/** A saved check, rebuilt field by field so a partial or older record can never pass as a full one. */
function savedCheck(previous: Stored, email: string): RecipientCheck | null {
  const levels: RecipientLevel[] = ["deliverable", "risky", "undeliverable"];
  if (!previous.level || !levels.includes(previous.level) || !previous.checkedAt) return null;
  return {
    email, level: previous.level, reason: previous.reason ?? "", source: previous.source ?? "own", status: previous.status ?? "unverified",
    suggestion: previous.suggestion ?? null, hunter: previous.hunter ?? null, mailHost: previous.mailHost ?? null, checkedAt: previous.checkedAt,
  };
}

/** Does the domain accept mail? MX first, then the implicit A/AAAA fallback (RFC 5321). null = could not tell. */
export async function domainAcceptsMail(domain: string): Promise<boolean | null> {
  const missing = (error: unknown) => ["ENOTFOUND", "ENODATA", "ENONAME"].includes((error as { code?: string }).code ?? "");
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.some((record) => record.exchange && record.exchange !== ".")) return true;
    if (mx.length) return false; // RFC 7505 null MX: the domain explicitly accepts no mail.
  } catch (error) {
    if (!missing(error)) return null;
  }
  try {
    const hosts = await dns.resolve4(domain).catch(async (error) => { if (missing(error)) return dns.resolve6(domain); throw error; });
    return hosts.length > 0;
  } catch (error) {
    return missing(error) ? false : null;
  }
}

/** The company's proven format, learned only from addresses that are real (never from our own guesses). */
async function provenFormat(db: SupabaseClient, account: RecipientAccount, person: RecipientPerson) {
  const { data } = await db.from("people").select("id,full_name,email,email_status,email_source,email_check").eq("account_id", account.id).not("email", "is", null).limit(80);
  const samples: Array<{ name: string; email: string }> = [];
  for (const row of (data ?? []) as RecipientPerson[]) {
    if (row.id === person.id || !row.email || row.email_status === "invalid") continue;
    const check = stored(row.email_check);
    const delivered = check.lastSentEmail === row.email && !check.bouncedEmail;
    const real = row.email_status === "verified" || delivered || !["pattern", "guess"].includes(row.email_source ?? "");
    if (real) samples.push({ name: row.full_name, email: row.email });
  }
  for (const contact of focusedContacts(account.domain)) {
    if (contact.email && contact.emailStatus === "published_unverified" && contact.name !== person.full_name) samples.push({ name: contact.name, email: contact.email });
  }
  return detectPattern(samples, account.domain);
}

function result(email: string, level: RecipientLevel, reason: string, source: RecipientCheck["source"], status: RecipientCheck["status"], extra: Partial<RecipientCheck> = {}, now = Date.now()): RecipientCheck {
  return { email, level, reason, source, status, suggestion: null, hunter: null, mailHost: null, checkedAt: new Date(now).toISOString(), ...extra };
}

export async function checkRecipient(db: SupabaseClient, person: RecipientPerson, account: RecipientAccount, deps: Deps = {}): Promise<RecipientCheck> {
  const now = deps.now?.() ?? Date.now();
  const email = (person.email ?? "").trim().toLowerCase();
  const previous = stored(person.email_check);
  if (!email) return result("", "undeliverable", `There is no email address on file for ${person.full_name}.`, "history", "invalid", {}, now);
  if (!SYNTAX.test(email)) return result(email, "undeliverable", `${email} is not a valid email address.`, "own", "invalid", {}, now);

  // What we already know.
  if (person.email_status === "invalid" || previous.bouncedEmail === email) {
    return result(email, "undeliverable", `${email} bounced or was rejected before. Find the right address before sending.`, "history", "invalid", { suggestion: previous.suggestion ?? null }, now);
  }
  if (person.email_status === "verified" && person.email_verified_at && now - Date.parse(person.email_verified_at) < VERIFIED_MS) {
    return result(email, "deliverable", "Verified address.", "history", "verified", {}, now);
  }
  if (previous.lastSentEmail === email && previous.lastSentAt && now - Date.parse(previous.lastSentAt) > BOUNCE_WINDOW_MS) {
    return result(email, "deliverable", "An earlier email to this address was delivered without a bounce.", "history", person.email_status === "catch_all" ? "catch_all" : "verified", {}, now);
  }
  const cached = previous.email === email ? savedCheck(previous, email) : null;
  if (cached && now - Date.parse(cached.checkedAt) < CACHE_MS) return cached;

  // Hunter, when it can answer.
  let hunterStatus: string | null = null;
  if (deps.hunter || verifierConfigured()) {
    try {
      const verdict = await (deps.hunter ?? verifyEmail)(email);
      hunterStatus = verdict.status;
      if (verdict.status === "verified") return result(email, "deliverable", "Hunter verified this address.", "hunter", "verified", { hunter: hunterStatus }, now);
      if (verdict.status === "invalid") return result(email, "undeliverable", `Hunter reports ${email} cannot receive mail.`, "hunter", "invalid", { hunter: hunterStatus }, now);
    } catch (error) {
      hunterStatus = `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 120);
    }
  }

  // Our own checks for the gaps.
  const domain = email.split("@")[1];
  const mailHost = await (deps.mailHost ?? domainAcceptsMail)(domain);
  if (mailHost === false) return result(email, "undeliverable", `${domain} does not accept email (no mail server).`, "own", "invalid", { hunter: hunterStatus, mailHost }, now);
  const format = await provenFormat(db, account, person);
  const expected = format ? buildEmail(person.full_name, format.key, account.domain) : null;
  const catchAll = hunterStatus === "catch_all";
  const status: RecipientCheck["status"] = catchAll ? "catch_all" : "unverified";
  const extra = { hunter: hunterStatus, mailHost };
  if (expected && expected === email && format && format.confidence >= 0.6) {
    return result(email, "risky", `Matches the company's ${format.key} format, proven by ${format.matched} real address${format.matched === 1 ? "" : "es"}.`, "own", status, extra, now);
  }
  if (expected && expected !== email && format && format.confidence >= 0.8) {
    return result(email, "risky", `Addresses at ${account.domain} follow the ${format.key} format; this one does not. Consider ${expected}.`, "own", status, { ...extra, suggestion: expected }, now);
  }
  const why = catchAll ? "The domain accepts every address, so it cannot be confirmed." : "Not confirmed by Hunter or by the company's known format.";
  return result(email, "risky", why, "own", status, extra, now);
}

/** Save what the check learned on the person, so the next send and the desk see it. */
export async function recordRecipientCheck(db: SupabaseClient, person: RecipientPerson, check: RecipientCheck) {
  const previous = stored(person.email_check);
  const patch: Record<string, unknown> = { email_check: { ...previous, ...check } };
  if (check.status === "invalid") patch.email_status = "invalid";
  else if (check.source !== "history" && (check.status === "verified" || check.status === "catch_all")) {
    patch.email_status = check.status;
    patch.email_verified_at = check.checkedAt;
  }
  await db.from("people").update(patch).eq("id", person.id);
}

/** After Gmail accepts a send: start the bounce window for this exact address. */
export async function recordDelivery(db: SupabaseClient, personId: string, email: string) {
  const { data } = await db.from("people").select("email_check").eq("id", personId).maybeSingle();
  await db.from("people").update({ email_check: { ...stored(data?.email_check), lastSentEmail: email.toLowerCase(), lastSentAt: new Date().toISOString() } }).eq("id", personId);
}

/** A delivery failure came back: the address is wrong. Offer the proven format's address when there is one. */
export async function markBounced(db: SupabaseClient, person: RecipientPerson, account: RecipientAccount | null) {
  const email = (person.email ?? "").toLowerCase();
  const format = account ? await provenFormat(db, account, person) : null;
  const built = format && account ? buildEmail(person.full_name, format.key, account.domain) : null;
  const suggestion = built && built !== email ? built : null;
  await db.from("people").update({
    email_status: "invalid",
    email_check: { ...stored(person.email_check), bouncedEmail: email, level: "undeliverable", reason: `${email} bounced.`, source: "history", status: "invalid", suggestion, checkedAt: new Date().toISOString(), email },
  }).eq("id", person.id);
  return suggestion;
}

/** Manual sends stop only on a known-bad address; automatic sends need a known-good one. */
export function recipientAllowed(check: RecipientCheck, automatic: boolean) {
  return automatic ? check.level === "deliverable" : check.level !== "undeliverable";
}
