import Link from "next/link";
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

export default async function Followups({searchParams}:{searchParams:Promise<{view?:string;page?:string;owner?:string}>}) {
  const params=await searchParams, history=params.view==='sent', paused=params.view==='paused', page=Math.max(1,Math.min(10000,Math.floor(Number(params.page)||1))), pageSize=100;
  const owner=['josh','jenna'].includes(params.owner??'')?params.owner:undefined;
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const user = await requireUser();
  const pending = await pendingMigrations(admin());
  if (pending.length) return <MigrationRequired pending={pending} />;

  const db = admin();
  let query = db
    .from("cadence_steps")
    .select("id,step_number,channel,title,detail,subject,body,status,error,sent_at,scheduled_at,cadences!inner(status,owner,people(full_name,title),cards(id,email_subject,people(full_name,title),accounts(name,domain)))")
    .in("status", history ? ['sent'] : ["pending", "ready", "failed"])
    .order("scheduled_at", { ascending: !history }).order('id')
    .range((page-1)*pageSize,page*pageSize);
  if(!history)query=query.in('cadences.status',paused?['paused','stopped','draft']:['active']);
  if(owner)query=query.eq('cadences.owner',owner);
  const {data,error}=await query;

  if (error) throw new Error("Could not load follow-ups. Reload to try again.");
  const now = new Date().getTime();
  const hasMore=(data?.length??0)>pageSize;
  const rows = (data ?? []).slice(0,pageSize) as unknown as StepRow[];
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
        cadenceStatus:row.cadences!.status,
        manualPending:row.error==='Manual activity pending',
        canSend: row.cadences!.owner === user.owner && (row.cadences!.status === "active" || row.error==='Manual activity pending'),
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
      <nav className="list-tabs" aria-label="Follow-up filters">
        <Link className="btn" href={`/followups?owner=${owner??''}`}>Action needed</Link>
        <Link className="btn" href={`/followups?view=sent&owner=${owner??''}`}>Sent history</Link>
        <Link className="btn" href={`/followups?view=paused&owner=${owner??''}`}>Paused and stopped</Link>
        <Link className="btn" href={`/followups?view=${history?'sent':paused?'paused':''}&owner=josh`}>Josh</Link>
        <Link className="btn" href={`/followups?view=${history?'sent':paused?'paused':''}&owner=jenna`}>Suuchi</Link>
        <Link className="btn" href={`/followups?view=${history?'sent':paused?'paused':''}`}>Both</Link>
      </nav>
      <FollowupsBoard items={items} />
      <nav aria-label="Follow-up pages"><span>Page {page}</span>{page>1&&<Link className="btn" href={`/followups?view=${history?'sent':paused?'paused':''}&owner=${owner??''}&page=${page-1}`}>Previous</Link>}{hasMore&&<Link className="btn" href={`/followups?view=${history?'sent':paused?'paused':''}&owner=${owner??''}&page=${page+1}`}>Next</Link>}</nav>
    </main>
  </div>;
}
