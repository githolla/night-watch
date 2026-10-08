"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Building2, BriefcaseBusiness, ChevronDown, LifeBuoy, Lock, MessageSquareText, PlayCircle, Settings, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import { Walkthrough } from "./Walkthrough";
import { FeedbackWidget } from "./FeedbackWidget";

const primary = [
  { href: "/outreach", label: "Reach-out list", hint: "The selected companies and their custom emails" },
  { href: "/drafts", label: "Drafts", hint: "Set up, check and fix your email drafts" },
  { href: "/followups", label: "Follow-ups", hint: "Queued follow-ups and anything due now" },
  { href: "/activity", label: "History", hint: "Everything sent, and every reply" },
  { href: "/people", label: "People", hint: "Every contact on file" },
];
// Plain names, an icon and one short line each, so it is obvious what is behind every link. System pages are admin only.
type MoreItem = { href: string; label: string; hint: string; icon: LucideIcon };
const moreGroups: Array<{ title: string; items: MoreItem[] }> = [
  { title: "How it's going", items: [
    { href: "/stats", label: "Results", hint: "Replies, meetings and what's working", icon: Trophy },
    { href: "/pipeline", label: "Pipeline", hint: "Conversations turning into deals", icon: TrendingUp },
  ] },
  { title: "Find companies", items: [
    { href: "/targets", label: "All companies", hint: "Search, add or remove companies", icon: Building2 },
    { href: "/roles", label: "Hiring signals", hint: "Jobs companies are hiring for", icon: BriefcaseBusiness },
    { href: "/posts", label: "Employee posts", hint: "What their people are posting", icon: MessageSquareText },
  ] },
  { title: "Settings", items: [
    { href: "/settings", label: "Settings", hint: "Gmail, signature and your team", icon: Settings },
    { href: "/runs", label: "Research runs", hint: "Nightly research and its cost", icon: PlayCircle },
    { href: "/delivery-recovery", label: "Unsure sends", hint: "Check emails that may not have sent", icon: LifeBuoy },
  ] },
];
const more = moreGroups.flatMap((group) => group.items);

export function Header({showTour=true}:{showTour?:boolean}) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === "/outreach" && pathname === "/") || (href === "/outreach" && pathname.startsWith("/accounts"));
  const [moreOpen, setMoreOpen] = useState(false);
  const [counts, setCounts] = useState<{ today: number; companies: number; followups: number } | null>(null);
  const [me, setMe] = useState<{ name: string; email: string; role: string; canAct?: boolean; actingError?: boolean; actor?: { name: string; email: string } } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  async function switchAccount(stop: boolean) {
    if (!window.confirm(stop ? "Exit Suuchi mode? Save any edits first." : "Act as Suuchi? Save any edits first. Emails and tests will send through her connected Gmail.")) return;
    setSwitching(true); setSwitchError("");
    try {
      const response = await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stop }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not switch accounts.");
      // A full reload clears cached drafts and sender state after changing identity.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/outreach");
    } catch (error) { setSwitchError(error instanceof Error ? error.message : "Account switch failed."); setSwitching(false); }
  }
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/nav-counts", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => { if (live && data) setCounts(data); }).catch(() => {});
    return () => { live = false; };
  }, [pathname]);
  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => { if (live && data && !data.error) setMe(data); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const meInitials = me?.name ? me.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") : "JL";
  useEffect(() => {
    function onClick(event: MouseEvent) { if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false); }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  const countFor = (href: string) => href === "/outreach" ? counts?.today : href === "/followups" ? counts?.followups : undefined;

  return (
    <>
    <header className="appbar" aria-label="Navigation">
      <div className="appbar-left">
        <Link href="/outreach" className="appbar-brand" title="Night Watch">
          <span className="brand-moon" aria-hidden />
          <strong>nightwatch<i>.</i></strong>
        </Link>
        <nav className="appbar-nav">
          {primary.map((item) => {
            const count = countFor(item.href);
            return <Link key={item.href} href={item.href} title={item.hint} className={active(item.href) ? "is-active" : ""}>{item.label}{count ? <b className="nav-count">{count}</b> : null}</Link>;
          })}
          <div className={`appbar-more ${moreOpen ? "is-open" : ""}`} ref={moreRef}>
            <button type="button" onClick={() => setMoreOpen((open) => !open)} className={more.some((item) => active(item.href)) ? "is-active" : ""} aria-expanded={moreOpen}>More <ChevronDown size={14} strokeWidth={1.8} /></button>
            {moreOpen && <div className="appbar-more-list appbar-more-groups">{moreGroups.map((group) => {
              const items = group.items.filter((item) => me?.role === "admin" || !["/runs", "/delivery-recovery"].includes(item.href));
              return items.length ? <div className="appbar-more-group" key={group.title}><span className="appbar-more-title">{group.title}</span>{items.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={`appbar-more-item ${active(item.href) ? "is-active" : ""}`} onClick={() => setMoreOpen(false)}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span><b>{item.label}</b><small>{item.hint}</small></span></Link>; })}</div> : null;
            })}</div>}
          </div>
        </nav>
      </div>
      <div className="appbar-right">
        {me?.canAct && !me.actor && !me.actingError && <button className="btn" disabled={switching} onClick={() => switchAccount(false)}>Act as Suuchi</button>}
        {showTour && <Walkthrough userKey={me?.email} />}
        <span className="appbar-ws">{me?.name ?? "Nine-67 workspace"}</span>
        <span className="ws-badge" title={me?.email ?? "Signed in"}>{meInitials}</span>
        <form action="/api/auth/logout" method="post"><button className="appbar-lock" type="submit" title="Lock"><Lock size={16} strokeWidth={1.8} /></button></form>
      </div>
    </header>
    {(me?.actor || me?.actingError) && <div role="status" style={{ padding: "12px 24px", background: "#fff1cf", borderBottom: "1px solid #d6ad56", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
      <div style={{ flex: 1 }}><strong>{me.actingError ? "Admin mode expired. Exit to continue." : `Acting as ${me.name}`}</strong>{me.actor && <div>Admin: {me.actor.name}. Sends use this account’s Gmail; test emails go to its inbox. Mode lasts one hour.</div>}</div>
      <button className="btn" disabled={switching} onClick={() => switchAccount(true)}>Exit admin mode</button>
    </div>}
    {switchError && <div role="alert" style={{ padding: "12px 24px", color: "#9c3027" }}>{switchError}</div>}
    <FeedbackWidget />
    </>
  );
}
