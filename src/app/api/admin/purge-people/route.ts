import { requireAdmin } from "@/lib/auth";
import { purgeNonPeople } from "@/lib/pipeline";

/**
 * Take everything off the contact list that is not a person: a service line or value prop scraped as a name
 * ("Strategic IT Guidance"), a page title ("Modern Slavery Statement"), a functional mailbox (recruiting@)
 * or a call to action off the company's own website ("Discover Untapped Performance", filed under the title
 * "Your Industry Partner").
 *
 * They are marked do_not_contact rather than deleted — an earlier version deleted, and took real contacts
 * with it when the name test was too narrow.
 *
 * Returns the names, so the result can be checked instead of believed.
 */
export async function POST() {
  try {
    await requireAdmin();
    const { removed, names } = await purgeNonPeople();
    return Response.json({ ok: true, removed, names });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Purge failed" }, { status: 400 });
  }
}
