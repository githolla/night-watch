import { refreshLegacyFollowup } from '@/lib/followups';
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
  error: string | null;
  sent_at: string | null;
  scheduled_at: string;
  cadences: {
    status: string;
    owner: string;
    people: { full_name: string; title: string } | null;
    cards: { id: string; email_subject: string | null; people: { full_name: string; title: string } | null; accounts: { name: string; domain: string } | null } | null;
  } | null;
};

export default async function Followups() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const user = await requireUser();
  const pending = await pendingMigrations(admin());
  if (pending.length) return <MigrationRequired pending={pending} />;

  const db = admin();
  const { data, error } = await db
    .from("cadence_steps")
    .select("id,step_number,channel,title,detail,subject,body,status,error,sent_at,scheduled_at,cadences!inner(status,owner,people(full_name,title),cards(id,email_subject,people(full_name,title),accounts(name,domain)))")
    .in("status", ["pending", "ready", "failed", "sent"])
    .order("scheduled_at", { ascending: true })
    .limit(500);

  if (error) throw new Error("Could not load follow-ups. Reload to try again.");
  const now = new Date().getTime();
  const rows = (data ?? []) as unknown as StepRow[];
  const items: FollowupItem[] = rows
    .filter((row) => row.cadences?.cards)
    .map((row) => {
      const card = row.cadences!.cards!;
      return {
        id: row.id,
        status: row.status,
        error: row.error,
        claimed: Boolean(row.sent_at) && row.status !== "sent",
        owner: row.cadences!.owner,
        canSend: row.cadences!.owner === user.owner && row.cadences!.status === "active",
        cardId: card.id,
        step: row.step_number,
        channel: row.channel,
        title: row.title,
        detail: row.detail,
        subject: row.subject,
        body: refreshLegacyFollowup(row.body ?? "",{firstName:row.cadences!.people?.full_name?.split(/\s+/)[0]??"there",company:card.accounts?.name??"your team",baseSubject:row.subject??"",step:row.step_number,channel:row.channel === "email"?"email":"linkedin_message"}),
        scheduledAt: row.scheduled_at,
        due: ["ready", "failed"].includes(row.status) || Date.parse(row.scheduled_at) <= now,
        person: row.cadences!.people?.full_name ?? "Unknown contact",
        personTitle: row.cadences!.people?.title ?? "",
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
