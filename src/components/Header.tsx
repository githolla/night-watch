"use client";

import { curatedDomains } from "@/lib/curated-worklist";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Walkthrough } from "./Walkthrough";
import { FeedbackWidget } from "./FeedbackWidget";

const primary = [
  { href: "/outreach", label: "Reach-out list", hint: "The selected companies and their custom emails" },
  { href: "/followups", label: "Follow-ups", hint: "Queued follow-ups and anything due now" },
  { href: "/people", label: "People", hint: "Every contact on file" },
];
const more = [
  { href: "/pipeline", label: "Pipeline", hint: "Qualified conversations and opportunities" },
  { href: "/activity", label: "History", hint: "Everything sent, and every reply" },
  { href: "/targets", label: "All companies", hint: "The full company table: search, filter, add or exclude" },
  { href: "/roles", label: "Job signals", hint: "Open roles found at target companies" },
  { href: "/posts", label: "Employee posts", hint: "Public posts found from people at target companies" },
  { href: "/runs", label: "Runs", hint: "Research runs and what each one cost" },
  { href: "/stats", label: "Results", hint: "Replies, meetings and what is working" },
  { href: "/settings", label: "Settings", hint: "Mailbox, identity, team and integrations" },
];

export function Header({showTour=true}:{showTour?:boolean}) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === "/outreach" && pathname === "/") || (href === "/outreach" && pathname.startsWith("/accounts"));
  const [moreOpen, setMoreOpen] = useState(false);
  const [counts, setCounts] = useState<{ today: number; companies: number; followups: number } | null>(null);
  const [me, setMe] = useState<{ name: string; email: string; role: string } | null>(null);
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

  const countFor = (href: string) => href === "/outreach" ? curatedDomains.length : href === "/followups" ? counts?.followups : undefined;

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
            {moreOpen && <div className="appbar-more-list">{more.map((item) => <Link key={item.href} href={item.href} title={item.hint} className={active(item.href) ? "is-active" : ""}>{item.label}<small>{item.hint}</small></Link>)}</div>}
          </div>
        </nav>
      </div>
      <div className="appbar-right">
        {showTour && <Walkthrough userKey={me?.email} />}
        <span className="appbar-ws">{me?.name ?? "Nine-67 workspace"}</span>
        <span className="ws-badge" title={me?.email ?? "Signed in"}>{meInitials}</span>
        <form action="/api/auth/logout" method="post"><button className="appbar-lock" type="submit" title="Lock"><Lock size={16} strokeWidth={1.8} /></button></form>
      </div>
    </header>
    <FeedbackWidget />
    </>
  );
}
