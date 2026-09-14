"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Activity, BarChart3, Briefcase, Building2, ChevronDown, ChevronsLeft, ChevronsRight, Inbox, Lock, MessageSquare, Settings, Target, Users } from "lucide-react";

/**
 * Two pages do the daily work and sit at the top: the desk (today's people
 * and their drafts) and the reach-out list. Everything else is reference and
 * lives under a "More" disclosure that stays closed until it is needed.
 */
const primary = [
  { href: "/desk", label: "Today", icon: Inbox },
  { href: "/outreach", label: "Companies", icon: Target },
];
const more = [
  { href: "/targets", label: "All companies", icon: Building2 },
  { href: "/roles", label: "Roles", icon: Briefcase },
  { href: "/posts", label: "Posts", icon: MessageSquare },
  { href: "/people", label: "People", icon: Users },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/stats", label: "Results", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function readCollapsed() {
  try { return window.localStorage.getItem("nw-sidebar") === "collapsed"; } catch { return false; }
}
function subscribe(onChange: () => void) {
  window.addEventListener("nw-sidebar", onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener("nw-sidebar", onChange); window.removeEventListener("storage", onChange); };
}

export function Header() {
  const pathname = usePathname();
  // The remembered state is read from storage inside an external-store subscription, never during render.
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === "/desk" && pathname === "/");
  // Open "More" on arrival when the current page lives inside it, so nobody lands on a page the nav is hiding.
  const [moreOpen, setMoreOpen] = useState(() => more.some((item) => active(item.href)));

  function toggleCollapsed() {
    try { window.localStorage.setItem("nw-sidebar", collapsed ? "open" : "collapsed"); } catch { /* no storage */ }
    window.dispatchEvent(new Event("nw-sidebar"));
  }

  const link = (item: { href: string; label: string; icon: typeof Inbox }) =>
    <Link key={item.href} href={item.href} className={active(item.href) ? "is-active" : ""} title={item.label}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span></Link>;

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`} aria-label="Navigation">
      <Link href="/desk" className="sidebar-brand" title="Night Watch">
        <strong>Nine-67</strong>
        <span>Night Watch</span>
      </Link>
      <nav className="sidebar-nav">
        {primary.map(link)}
        {collapsed ? more.map(link) : <>
          <button type="button" className={`sidebar-more ${moreOpen ? "is-open" : ""}`} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}>
            <ChevronDown size={16} strokeWidth={1.8} /><span>More</span>
          </button>
          {moreOpen && <div className="sidebar-more-list">{more.map(link)}</div>}
        </>}
      </nav>
      <div className="sidebar-foot">
        <button type="button" className="sidebar-toggle" onClick={toggleCollapsed} title={collapsed ? "Expand" : "Collapse"}>{collapsed ? <ChevronsRight size={18} strokeWidth={1.8} /> : <ChevronsLeft size={18} strokeWidth={1.8} />}<span>Collapse</span></button>
        <form action="/api/auth/logout" method="post">
          <button className="sidebar-lock" type="submit" title="Lock"><Lock size={18} strokeWidth={1.8} /><span>Lock</span></button>
        </form>
      </div>
    </aside>
  );
}
