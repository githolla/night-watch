"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Activity, BarChart3, Briefcase, Building2, ChevronDown, ChevronsLeft, ChevronsRight, LayoutGrid, Lock, MessageSquare, Settings, Target, Users } from "lucide-react";

/**
 * The daily work sits at the top — the overview and the company watchlist —
 * and everything else is reference under a "More" disclosure that stays closed
 * until it is needed.
 */
const primary = [
  { href: "/desk", label: "Today", icon: LayoutGrid },
  { href: "/outreach", label: "Companies", icon: Target },
  { href: "/people", label: "People", icon: Users },
];
const more = [
  { href: "/targets", label: "All companies", icon: Building2 },
  { href: "/roles", label: "Job signals", icon: Briefcase },
  { href: "/posts", label: "Employee posts", icon: MessageSquare },
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
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === "/desk" && pathname === "/") || (href === "/outreach" && pathname.startsWith("/accounts"));
  // Open "More" on arrival when the current page lives inside it, so nobody lands on a page the nav is hiding.
  const [moreOpen, setMoreOpen] = useState(() => more.some((item) => active(item.href)));
  // Small state counts for the nav badges, refreshed on each navigation.
  const [counts, setCounts] = useState<{ today: number; companies: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/nav-counts", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((data) => { if (live && data) setCounts(data); }).catch(() => {});
    return () => { live = false; };
  }, [pathname]);
  const countFor = (href: string) => href === "/desk" ? counts?.today : href === "/outreach" ? counts?.companies : undefined;

  function toggleCollapsed() {
    try { window.localStorage.setItem("nw-sidebar", collapsed ? "open" : "collapsed"); } catch { /* no storage */ }
    window.dispatchEvent(new Event("nw-sidebar"));
  }

  const link = (item: { href: string; label: string; icon: typeof LayoutGrid }) => {
    const count = countFor(item.href);
    return <Link key={item.href} href={item.href} className={active(item.href) ? "is-active" : ""} title={item.label}><item.icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{count ? <b className="nav-count">{count}</b> : null}</Link>;
  };

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`} aria-label="Navigation">
      <Link href="/desk" className="sidebar-brand" title="Night Watch">
        <span className="brand-moon" aria-hidden />
        <strong>nightwatch<i>.</i></strong>
      </Link>

      <div className="workspace-switch">
        <span className="ws-badge">N</span>
        <div><strong>Nine-67 workspace</strong><small>Company intelligence</small></div>
      </div>

      <nav className="sidebar-nav">
        <span className="nav-section">Workspace</span>
        {primary.map(link)}
        {collapsed ? more.map(link) : <>
          <button type="button" className={`sidebar-more ${moreOpen ? "is-open" : ""}`} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}>
            <ChevronDown size={15} strokeWidth={1.8} /><span>More</span>
          </button>
          {moreOpen && <div className="sidebar-more-list">{more.map(link)}</div>}
        </>}
      </nav>

      <div className="sidebar-status">
        <span className="sidebar-status-head"><i />Night Watch</span>
        <small>Scans nightly · 2:00 AM</small>
        <p>Your next reach-out starts with a signal.</p>
      </div>

      <div className="sidebar-foot">
        <div className="sidebar-user">
          <span className="ws-badge">JL</span>
          <div><strong>Josh Lee</strong><small>Nine-67</small></div>
        </div>
        <div className="sidebar-foot-actions">
          <button type="button" className="sidebar-toggle" onClick={toggleCollapsed} title={collapsed ? "Expand" : "Collapse"}>{collapsed ? <ChevronsRight size={17} strokeWidth={1.8} /> : <ChevronsLeft size={17} strokeWidth={1.8} />}<span>Collapse</span></button>
          <form action="/api/auth/logout" method="post">
            <button className="sidebar-lock" type="submit" title="Lock"><Lock size={17} strokeWidth={1.8} /><span>Lock</span></button>
          </form>
        </div>
      </div>
    </aside>
  );
}
