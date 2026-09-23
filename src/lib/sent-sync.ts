import { admin } from "./supabase/admin.ts";
import { listSent, messageMeta, messageBody, ownerAccessToken } from "./gmail.ts";
import type { Owner } from "./types.ts";

/** Pull the email address out of a "Name <email>" (or bare) To header. */
function addressOf(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return (m ? m[1] : value).split(",")[0].trim().toLowerCase();
}

/** Track emails composed directly in Gmail: read each connected seat's Sent folder, match the
 *  recipient to a known contact, and log it to History — so outreach is recorded whether it went
 *  out from Night Watch or from Gmail. Deduped against sends already logged. */
export async function runSentSync(): Promise<{ scanned: number; logged: number }> {
  const db = admin();
  const { data: conns } = await db.from("gmail_connections").select("owner");
  let scanned = 0;
  let logged = 0;

  for (const conn of conns ?? []) {
    const owner = conn.owner as Owner;
    let token: string;
    try { token = await ownerAccessToken(owner); } catch { continue; }
    let messages: Array<{ id: string; threadId: string }>;
    try { messages = await listSent(token); } catch { continue; }

    for (const msg of messages) {
      scanned++;
      let meta: { to: string; subject: string; threadId: string; dateMs: number };
      try { meta = await messageMeta(token, msg.id); } catch { continue; }
      // Self-tests must never be imported as prospect outreach.
      if (meta.subject.startsWith("[Night Watch test] ")) continue;
      const to = addressOf(meta.to);
      if (!to || !to.includes("@")) continue;

      // Only track sends to a known contact who has a card (so History can show company/person).
      // Escape LIKE wildcards so a "%"/"_" in the address matches literally (not as a wildcard) while
      // keeping ilike's case-insensitivity for email matching.
      const { data: person } = await db.from("people").select("id").ilike("email", to.replace(/[\\%_]/g, "\\$&")).maybeSingle();
      if (!person) continue;
      const { data: card } = await db.from("cards").select("id").eq("person_id", person.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!card) continue;

      // Dedup: skip if an email touch for this contact by this seat already exists near this time
      // (covers in-app sends, which are already logged, and re-runs of this sync).
      const at = meta.dateMs || Date.now();
      const lo = new Date(at - 120000).toISOString();
      const hi = new Date(at + 120000).toISOString();
      const { count } = await db.from("touches").select("*", { count: "exact", head: true }).eq("person_id", person.id).eq("channel", "email").eq("sent_by", owner).gte("sent_at", lo).lte("sent_at", hi);
      if ((count ?? 0) > 0) continue;

      // Store the full message text so History can show the entire email; fall back to the subject.
      let fullBody = "";
      try { fullBody = await messageBody(token, msg.id); } catch { /* keep fallback */ }
      const { error } = await db.from("touches").insert({
        card_id: card.id,
        person_id: person.id,
        channel: "email",
        sent_at: new Date(at).toISOString(),
        sent_by: owner,
        gmail_thread_id: meta.threadId,
        body: fullBody.trim() || (meta.subject ? `(sent from Gmail) ${meta.subject}` : "(sent from Gmail)"),
      });
      if (!error) logged++;
    }
  }
  return { scanned, logged };
}
