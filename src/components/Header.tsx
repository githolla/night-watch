"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";

/** A clean top bar: the daily work first, everything else under More, workspace and user on the right. */
const primary = [
  { href: "/desk", label: "Outreach" },
  { href: "/followups", label: "Follow-ups" },
  { href: "/outreach", label: "Companies" },
  { href: "/people", label: "People" },
];
const more = [
  { href: "/activity", label: "History" },
  { href: "/targets", label: "All companies" },
  { href: "/roles", label: "Job signals" },
  { href: "/posts", label: "Employee posts" },
  { href: "/runs", label: "Runs" },
  { href: "/stats", label: "Results" },
  { href: "/settings", label: "Settings" },
];

export function Header() {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === "/desk" && pathname === "/") || (href === "/outreach" && pathname.startsWith("/accounts"));
  const [moreOpen, setMoreOpen] = useState(false);
  const [counts, setCounts] = useState<{ today: number; companies: number; followups: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/nav-counts", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => { if (live && data) setCounts(data); }).catch(() => {});
    return () => { live = false; };
  }, [pathname]);
  useEffect(() => {
    function onClick(event: MouseEvent) { if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false); }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  const countFor = (href: string) => href === "/desk" ? counts?.today : href === "/outreach" ? counts?.companies : href === "/followups" ? counts?.followups : undefined;

  return (
    <header className="appbar" aria-label="Navigation">
      <div className="appbar-left">
        <Link href="/desk" className="appbar-brand" title="Night Watch">
          <span className="brand-moon" aria-hidden />
          <strong>nightwatch<i>.</i></strong>
        </Link>
        <nav className="appbar-nav">
          {primary.map((item) => {
            const count = countFor(item.href);
            return <Link key={item.href} href={item.href} className={active(item.href) ? "is-active" : ""}>{item.label}{count ? <b className="nav-count">{count}</b> : null}</Link>;
          })}
          <div className={`appbar-more ${moreOpen ? "is-open" : ""}`} ref={moreRef}>
            <button type="button" onClick={() => setMoreOpen((open) => !open)} className={more.some((item) => active(item.href)) ? "is-active" : ""} aria-expanded={moreOpen}>More <ChevronDown size={14} strokeWidth={1.8} /></button>
            {moreOpen && <div className="appbar-more-list">{more.map((item) => <Link key={item.href} href={item.href} className={active(item.href) ? "is-active" : ""}>{item.label}</Link>)}</div>}
          </div>
        </nav>
      </div>
      <div className="appbar-right">
        <span className="appbar-ws">Nine-67 workspace</span>
        <span className="ws-badge">JL</span>
        <form action="/api/auth/logout" method="post"><button className="appbar-lock" type="submit" title="Lock"><Lock size={16} strokeWidth={1.8} /></button></form>
      </div>
    </header>
  );
}
