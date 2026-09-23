import research from "../../../data/priority-outreach.json";
const drafts = research.map((row, id) => ({ ...row, id, recipientName: row.buyer.name, buyerSourceUrl: row.buyer.sourceUrl, tier: row.sector, sourceUrl: row.trigger.sourceUrl, signal: row.trigger.fact, rationale: `${row.hypothesis} Limitations: ${Array.isArray(row.limitations) ? row.limitations.join(" ") : row.limitations}` }));
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { senderProfile, renderSignatureText } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import { CustomizedEmails } from "@/components/CustomizedEmails";

export const dynamic = "force-dynamic";
export default async function PriorityEmailsPage() {
  const me = await requireUser();
  const db = admin();
  const profile = await senderProfile(db, me.owner);
  const { data: mailbox } = await db.from("gmail_connections").select("email").eq("owner", me.owner).maybeSingle();
  return <div className="shell"><Header /><CustomizedEmails curated drafts={drafts} greeting={profile.greeting} signoff={profile.signoff} signature={renderSignatureText(profile, mailbox?.email ?? "")} sender={profile.fromName || me.name} /></div>;
}
