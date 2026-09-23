import { versionLabel, versionMeta } from "@/lib/version-attribution";
import { firstOpenAt } from "@/lib/open-tracking";
import { ActivityView, type ActivityEvent } from "@/components/ActivityView";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type TouchRow = {
  id: string;
  card_id: string | null;
  channel: string;
  sent_at: string | null;
  created_at: string;
  reply_at: string | null;
  reply_classification: string;
  body: string | null;
  sent_by: string;
  gmail_thread_id: string | null;
  people: { full_name: string; title: string; email: string | null } | null;
  message_variants: { subject: string; dimensions: unknown; message_experiments: { context: string } | null } | null;
  cards: { email_subject: string | null; linkedin_subject: string | null; accounts: { name: string } | null; people: { full_name: string; title: string; email: string | null } | null } | null;
};

type Params = { person?: string; name?: string };

export default async function Activity({ searchParams }: { searchParams: Promise<Params> }) {
  if (
    !(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) ||
    !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)
  )
    redirect("/setup");
  const me = await requireUser();
  const pending = await pendingMigrations(admin());
  if (pending.length) return <MigrationRequired pending={pending} />;

  const params = await searchParams;
  const personId = params.person?.trim() || "";
  const db = admin();
  let query = db
    .from("touches")
    .select("id,card_id,channel,sent_at,created_at,reply_at,reply_classification,body,sent_by,gmail_thread_id,people(full_name,title,email),message_variants(subject,dimensions,message_experiments(context)),cards(email_subject,linkedin_subject,accounts(name),people(full_name,title,email))")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (personId) query = query.eq("person_id", personId);
  const { data, error } = await query;
  const { count: totalTouches } = await db.from("touches").select("*", { count: "exact", head: true });

  // Seat → display name, so History shows "Sent by Josh / Suuchi" rather than the raw seat slug.
  const { data: profileRows } = await db.from("sender_profiles").select("owner,from_name");
  const seatName: Record<string, string> = {};
  for (const row of (profileRows ?? []) as Array<{ owner: string; from_name: string | null }>)
    if (row.from_name?.trim()) seatName[row.owner] = row.from_name.trim();
  const senderLabel = (owner: string) => seatName[owner] || (owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : "Unknown");

  // Cards currently enrolled in a cadence, so History can flag/filter "in cadence" sends.
  const { data: cadenceRows } = await db.from("cadences").select("card_id").eq("status", "active");
  const cadenceCards = new Set((cadenceRows ?? []).map((row) => (row as { card_id: string }).card_id));
  const note = error
    ? `Couldn't load history: ${error.message}`
    : (totalTouches ?? 0) === 0
      ? "Nothing recorded yet. History fills when you send, explicitly mark a message sent, or a cadence sends. Copying does not count as sending. (Enrolling with “Automate” only shows here once its emails actually send — which needs Gmail connected.)"
      : null;

  const rows = (data ?? []) as unknown as TouchRow[];
  const events: ActivityEvent[] = rows.map((row) => {
    const when = row.sent_at ?? row.created_at;
    const body = (row.body ?? "").trim();
    return {
      id: row.id,
      at: when,
      day: when.slice(0, 10),
      channel: row.channel,
      owner: row.sent_by,
      sentBy: senderLabel(row.sent_by),
      person: row.people?.full_name ?? row.cards?.people?.full_name ?? "Unknown contact",
      title: row.people?.title ?? row.cards?.people?.title ?? "",
      company: row.cards?.accounts?.name ?? "Unknown company",
      to: row.channel === "email" ? row.people?.email ?? row.cards?.people?.email ?? null : null,
      subject: row.channel === "email" ? row.message_variants?.subject ?? row.cards?.email_subject ?? null : row.cards?.linkedin_subject ?? null,
      body,
      snippet: body.replace(/\s+/g, " ").slice(0, 140),
      replied: Boolean(row.reply_at),
      replyClass: row.reply_classification,
      inCadence: row.card_id ? cadenceCards.has(row.card_id) : false,
      gmailThreadId: row.gmail_thread_id ?? null,
      version: row.channel === "email" ? versionLabel(row.message_variants?.dimensions) : undefined,
      openAt: firstOpenAt(row.message_variants?.message_experiments?.context),
      trackedOpen: Boolean(versionMeta(row.message_variants?.dimensions) && row.gmail_thread_id),
      sendSource: row.gmail_thread_id ? "Gmail" : versionMeta(row.message_variants?.dimensions)?.source === "manual" ? "Marked sent" : "Legacy record: delivery not confirmed",

    };
  });

  const who = personId ? { name: params.name?.trim() || events[0]?.person || "this contact" } : null;

  return (
    <div className="shell">
      <Header />
      <ActivityView events={events} who={who} note={note} canDelete={me.role === "admin"} />
    </div>
  );
}
