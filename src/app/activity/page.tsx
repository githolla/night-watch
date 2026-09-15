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
  channel: string;
  sent_at: string | null;
  created_at: string;
  reply_at: string | null;
  reply_classification: string;
  body: string | null;
  sent_by: string;
  cards: { email_subject: string | null; accounts: { name: string } | null; people: { full_name: string; title: string } | null } | null;
};

type Params = { person?: string; name?: string };

export default async function Activity({ searchParams }: { searchParams: Promise<Params> }) {
  if (
    !(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) ||
    !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)
  )
    redirect("/setup");
  await requireUser();
  const pending = await pendingMigrations(admin());
  if (pending.length) return <MigrationRequired pending={pending} />;

  const params = await searchParams;
  const personId = params.person?.trim() || "";
  const db = admin();
  let query = db
    .from("touches")
    .select("id,channel,sent_at,created_at,reply_at,reply_classification,body,sent_by,cards(email_subject,accounts(name),people(full_name,title))")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (personId) query = query.eq("person_id", personId);
  const { data } = await query;

  const rows = (data ?? []) as unknown as TouchRow[];
  const events: ActivityEvent[] = rows.map((row) => {
    const when = row.sent_at ?? row.created_at;
    return {
      id: row.id,
      at: when,
      day: when.slice(0, 10),
      channel: row.channel,
      owner: row.sent_by,
      person: row.cards?.people?.full_name ?? "Unknown contact",
      title: row.cards?.people?.title ?? "",
      company: row.cards?.accounts?.name ?? "Unknown company",
      subject: row.channel === "email" ? row.cards?.email_subject ?? null : null,
      snippet: (row.body ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
      replied: Boolean(row.reply_at),
      replyClass: row.reply_classification,
    };
  });

  const who = personId ? { name: params.name?.trim() || events[0]?.person || "this contact" } : null;

  return (
    <div className="shell">
      <Header />
      <ActivityView events={events} who={who} />
    </div>
  );
}
