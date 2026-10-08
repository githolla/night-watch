"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Walkthrough } from "./Walkthrough";
import { FeedbackWidget } from "./FeedbackWidget";

const primary = [
  { href: "/outreach", label: "Reach-out list", hint: "The selected companies and their custom emails" },
  { href: "/drafts", label: "Drafts", hint: "Set up, check and fix your email drafts" },
  { href: "/followups", label: "Follow-ups", hint: "Queued follow-ups and anything due now" },
  { href: "/activity", label: "History", hint: "Everything sent, and every reply" },
  { href: "/people", label: "People", hint: "Every contact on file" },
];
// Grouped and short: the descriptions live in each link's tooltip. System pages are for admins only.
const moreGroups: Array<{ title: string; adminOnly?: boolean; items: Array<{ href: string; label: string; hint: string }> }> = [
  { title: "Results", items: [
    { href: "/pipeline", label: "Pipeline", hint: "Qualified conversations and opportunities" },
    { href: "/stats", label: "Results", hint: "Replies, meetings and what is working" },
  ] },
  { title: "Research", items: [
    { href: "/targets", label: "All companies", hint: "The full company table: search, filter, add or exclude" },
    { href: "/roles", label: "Job signals", hint: "Open roles found at target companies" },
    { href: "/posts", label: "Employee posts", hint: "Public posts found from people at target companies" },
  ] },
  { title: "System", items: [
    { href: "/settings", label: "Settings", hint: "Mailbox, identity, team and integrations" },
    { href: "/runs", label: "Runs", hint: "Research runs and what each one cost" },
    { href: "/delivery-recovery", label: "Delivery recovery", hint: "Check uncertain sends before retrying" },
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
              return items.length ? <div className="appbar-more-group" key={group.title}><span className="appbar-more-title">{group.title}</span>{items.map((item) => <Link key={item.href} href={item.href} title={item.hint} className={active(item.href) ? "is-active" : ""} onClick={() => setMoreOpen(false)}>{item.label}</Link>)}</div> : null;
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
