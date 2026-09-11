"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Activity, BarChart3, Briefcase, Building2, ChevronsLeft, ChevronsRight, Inbox, Lock, MessageSquare, Settings, Sun, Target, Users } from "lucide-react";

/** The left sidebar: two working pages first, the rest below, collapsible to icons. */
const primary = [
  { href: "/outreach", label: "Reach-out", icon: Target },
  { href: "/desk", label: "Desk", icon: Inbox },
];
const secondary = [
  { href: "/targets", label: "All companies", icon: Building2 },
  { href: "/roles", label: "Roles", icon: Briefcase },
  { href: "/posts", label: "Posts", icon: MessageSquare },
  { href: "/people", label: "People", icon: Users },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/stats", label: "Results", icon: BarChart3 },
  { href: "/today", label: "Today", icon: Sun },
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
  function toggle() {
    try { window.localStorage.setItem("nw-sidebar", collapsed ? "open" : "collapsed"); } catch { /* no storage */ }
    window.dispatchEvent(new Event("nw-sidebar"));
  }
  const active = (href: string) => pathname === href || (href !== "/outreach" && pathname.startsWith(`${href}/`)) || (href === "/outreach" && (pathname === "/" || pathname.startsWith("/accounts/")));

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`} aria-label="Navigation">
      <Link href="/outreach" className="sidebar-brand" title="Night Watch">
        <strong>Nine-67</strong>
        <span>Night Watch</span>
      </Link>
      <nav className="sidebar-nav">
        {primary.map((item) => <Link key={item.href} href={item.href} className={active(item.href) ? "is-active" : ""} title={item.label}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span></Link>)}
        <i className="sidebar-rule" />
        {secondary.map((item) => <Link key={item.href} href={item.href} className={active(item.href) ? "is-active" : ""} title={item.label}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span></Link>)}
      </nav>
      <div className="sidebar-foot">
        <button type="button" className="sidebar-toggle" onClick={toggle} title={collapsed ? "Expand" : "Collapse"}>{collapsed ? <ChevronsRight size={18} strokeWidth={1.8} /> : <ChevronsLeft size={18} strokeWidth={1.8} />}<span>Collapse</span></button>
        <form action="/api/auth/logout" method="post">
          <button className="sidebar-lock" type="submit" title="Lock"><Lock size={18} strokeWidth={1.8} /><span>Lock</span></button>
        </form>
      </div>
    </aside>
  );
}
