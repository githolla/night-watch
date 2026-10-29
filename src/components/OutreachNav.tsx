import Link from "next/link";
import type { Owner } from "@/lib/types";

export function OutreachNav({ owner, active }: { owner: Owner; active: "overview" | "drafts" | "sent" | "calls" | "linkedin" | "queue" }) {
  const tabs = [["overview", "/engagement", "Outreach overview"], ["queue", "/auto-send", "Email queue"], ["drafts", "/drafts", "Drafts"], ["sent", "/drafts/sent", "Sent emails"], ["calls", "/calls", "Calls"], ["linkedin", "/linkedin", "LinkedIn"]] as const;
  return <nav aria-label="Outreach workspace" className="mb-5 flex gap-1 overflow-x-auto border-b border-stone-200 pb-1">{tabs.map(([key, href, label]) => <Link key={key} href={`${href}?owner=${owner}`} aria-current={active === key ? "page" : undefined} className={`shrink-0 rounded-t-lg px-4 py-3 text-sm font-medium ${active === key ? "border-b-2 border-emerald-700 bg-emerald-50 text-emerald-900" : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"}`}>{label}</Link>)}</nav>;
}
