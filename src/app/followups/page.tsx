import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { Header } from "@/components/Header";
import { FollowupsBoard, type FollowupItem } from "@/components/FollowupsBoard";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type StepRow = {
  id: string;
  step_number: number;
  channel: string;
  title: string;
  detail: string;
  subject: string | null;
  body: string | null;
  status: string;
  scheduled_at: string;
  cadences: {
    status: string;
    cards: { id: string; email_subject: string | null; people: { full_name: string; title: string } | null; accounts: { name: string; domain: string } | null } | null;
  } | null;
};

export default async function Followups() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const pending = await pendingMigrations(admin());
  if (pending.length) return <MigrationRequired pending={pending} />;

  const db = admin();
  const { data } = await db
    .from("cadence_steps")
    .select("id,step_number,channel,title,detail,subject,body,status,scheduled_at,cadences!inner(status,cards(id,email_subject,people(full_name,title),accounts(name,domain)))")
    .eq("kind", "review")
    .in("status", ["pending", "ready"])
    .order("scheduled_at", { ascending: true })
    .limit(500);

  const now = new Date().getTime();
  const rows = (data ?? []) as unknown as StepRow[];
  const items: FollowupItem[] = rows
    .filter((row) => row.cadences?.status === "active" && row.cadences?.cards)
    .map((row) => {
      const card = row.cadences!.cards!;
      return {
        id: row.id,
        cardId: card.id,
        step: row.step_number,
        channel: row.channel,
        title: row.title,
        detail: row.detail,
        subject: row.subject,
        body: row.body ?? "",
        scheduledAt: row.scheduled_at,
        due: row.status === "ready" || Date.parse(row.scheduled_at) <= now,
        person: card.people?.full_name ?? "Unknown contact",
        personTitle: card.people?.title ?? "",
        company: card.accounts?.name ?? "Unknown company",
        domain: card.accounts?.domain ?? "",
      };
    });

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <FollowupsBoard items={items} />
    </main>
  </div>;
}
