import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { PipelineBoard, type PipelineCard } from "@/components/PipelineBoard";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type CardRow = {
  id: string; status: string; score: number; account_id: string;
  meeting_at: string | null; qualified_at: string | null; opportunity_at: string | null; opportunity_value_usd: number | null;
  accounts: { name: string; domain: string } | { name: string; domain: string }[] | null;
  people: { full_name: string; title: string } | { full_name: string; title: string }[] | null;
};
type TouchRow = { card_id: string | null; reply_at: string | null };

const REPLIED = ["replied", "positive", "meeting", "qualified", "opportunity"];

export default async function Pipeline() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const pending = await pendingMigrations(admin());
  if (pending.length) return <MigrationRequired pending={pending} />;

  const db = admin();
  const [cards, touches] = await Promise.all([
    fetchAll<CardRow>((from, to) => db.from("cards").select("id,status,score,account_id,meeting_at,qualified_at,opportunity_at,opportunity_value_usd,accounts(name,domain),people(full_name,title)").range(from, to)),
    fetchAll<TouchRow>((from, to) => db.from("touches").select("card_id,reply_at").range(from, to)),
  ]);

  const contacted = new Set<string>();
  const repliedByTouch = new Set<string>();
  for (const t of touches) { if (t.card_id) { contacted.add(t.card_id); if (t.reply_at) repliedByTouch.add(t.card_id); } }

  const rows: PipelineCard[] = cards
    .map((card) => {
      const account = (Array.isArray(card.accounts) ? card.accounts[0] : card.accounts) ?? null;
      const person = (Array.isArray(card.people) ? card.people[0] : card.people) ?? null;
      const status = card.status;
      const reached = {
        contacted: contacted.has(card.id) || REPLIED.includes(status) || status === "sent",
        replied: repliedByTouch.has(card.id) || REPLIED.includes(status),
        meeting: Boolean(card.meeting_at) || ["meeting", "qualified", "opportunity"].includes(status),
        qualified: Boolean(card.qualified_at) || ["qualified", "opportunity"].includes(status),
        opportunity: Boolean(card.opportunity_at) || status === "opportunity",
      };
      return {
        id: card.id,
        status,
        score: card.score,
        company: account?.name ?? "Unknown company",
        domain: account?.domain ?? "",
        person: person?.full_name ?? "Unknown contact",
        title: person?.title ?? "",
        valueUsd: card.opportunity_value_usd ?? null,
        reached,
      };
    })
    .filter((r) => r.reached.contacted && r.status !== "dismissed" && r.status !== "archived");

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <PipelineBoard cards={rows} />
    </main>
  </div>;
}
