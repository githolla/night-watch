import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

// A company that exists only to test sending. outreach_manual keeps the nightly file sync from touching
// it, outreach=false keeps it out of every research run, and the domain is unmistakable in any list.
const TEST_DOMAIN = "sequence-test.nine-67.invalid";

/**
 * Build a throwaway prospect addressed to your own inbox, so the first email and all three follow-ups can
 * be sent and read for real without touching a live contact.
 *
 * Testing this previously meant repointing a real person's row at your own address in SQL, editing
 * scheduled_at by hand, and calling the cron with its secret — three chances to leave a real prospect
 * mis-addressed. DELETE removes the company and everything hanging off it.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const db = admin();

    const { data: connection } = await db.from("gmail_connections").select("email").eq("owner", user.owner).maybeSingle();
    const to = (typeof body?.email === "string" && body.email.trim()) || connection?.email || user.email;
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return Response.json({ error: "Connect a Google account first, or type the address to send the test to." }, { status: 400 });
    }

    const { data: account, error: accountError } = await db.from("accounts").upsert({
      name: "Sequence test (safe to delete)", domain: TEST_DOMAIN, vertical: "Internal test",
      status: "active", tier: "A1", outreach: false, outreach_manual: true, target_titles: [],
      news_query: "", careers_url: null,
    }, { onConflict: "domain" }).select("id").single();
    if (accountError) return Response.json({ error: accountError.message }, { status: 400 });

    const { data: person, error: personError } = await db.from("people").upsert({
      account_id: account.id, full_name: "Test Recipient", first_name: "Test", last_name: "Recipient",
      title: "Chief Operating Officer", level: "owner", email: to, email_status: "verified", do_not_contact: false,
    }, { onConflict: "account_id,full_name" }).select("id").single();
    if (personError) return Response.json({ error: personError.message }, { status: 400 });

    const today = new Date().toISOString().slice(0, 10);
    const { data: signal, error: signalError } = await db.from("signals").upsert({
      account_id: account.id, person_id: person.id, type: "job_cluster",
      summary: "Two data and reporting roles open — a test signal, not real evidence.",
      source_url: "https://nine-67.com", observed_at: today, strength: 20,
      hash: "sequence-test-signal",
      raw: { operating_need: "reporting and data work", job: { title: "Data Engineer", responsibilities: ["Build and run the reporting"] } },
    }, { onConflict: "account_id,hash" }).select("id").single();
    if (signalError) return Response.json({ error: signalError.message }, { status: 400 });

    const { data: card, error: cardError } = await db.from("cards").upsert({
      signal_id: signal.id, person_id: person.id, account_id: account.id, score: 80,
      score_breakdown: { test: true }, brief: "A test prospect for checking the email and its follow-ups.",
      why_now: "Two data and reporting roles open for 25 days.", channel: "email_first",
      assigned_to: user.owner, status: "new",
      email_subject: "Sequence test from Night Watch",
      email_body: `Hi Test,\n\nThis is a test of the outreach sequence. If you are reading it in your inbox, the first email works: the From line, the signature and the opt-out line below are exactly what a prospect would see.\n\nThe three follow-ups are queued underneath this on the Worklist, each with a Send now button.\n\nThank you,`,
    }, { onConflict: "signal_id,person_id" }).select("id").single();
    if (cardError) return Response.json({ error: cardError.message }, { status: 400 });

    return Response.json({ ok: true, cardId: card.id, to, domain: TEST_DOMAIN });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not set up the test" }, { status: 400 });
  }
}

/** Remove the test company; the person, signal, card, cadence and its touches cascade away with it. */
export async function DELETE() {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const { error } = await admin().from("accounts").delete().eq("domain", TEST_DOMAIN);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not clean up" }, { status: 400 });
  }
}
