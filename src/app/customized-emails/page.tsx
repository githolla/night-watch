import drafts from "../../../data/customized-emails.json";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { senderProfile, renderSignatureText } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import { CustomizedEmails } from "@/components/CustomizedEmails";

export const dynamic = "force-dynamic";
export default async function CustomizedEmailsPage() {
  const me = await requireUser();
  const db = admin();
  const profile = await senderProfile(db, me.owner);
  const { data: mailbox } = await db.from("gmail_connections").select("email").eq("owner", me.owner).maybeSingle();
  return <div className="shell"><Header /><CustomizedEmails drafts={drafts} greeting={profile.greeting} signoff={profile.signoff} signature={renderSignatureText(profile, mailbox?.email ?? "")} sender={profile.fromName || me.name} /></div>;
}
