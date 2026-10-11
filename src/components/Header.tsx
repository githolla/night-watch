"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowsClockwise, Briefcase, CaretDown, ChartBar, ChatCircleText, ChatTeardropText, ClockCounterClockwise, GearSix, House, Lifebuoy, LinkedinLogo, List, ListChecks, MagnifyingGlass, PaperPlaneTilt, PencilSimpleLine, PlayCircle, SidebarSimple, SignOut, TrendUp, UserSwitch, Users, type Icon } from "@phosphor-icons/react";
import { Walkthrough } from "./Walkthrough";
import { FeedbackWidget } from "./FeedbackWidget";

// The sidebar: the daily pages first, then how it is going, then finding companies. Plain names, an icon and
// one short line each. System pages are admin only.
type NavItem = { href: string; label: string; hint: string; icon: Icon; adminOnly?: boolean };
const navGroups: Array<{ title: string | null; label?: string; items: NavItem[] }> = [
  { title: null, label: "Workspace", items: [
    { href: "/", label: "Overview", hint: "Your next action, what needs you and how it is going", icon: House },
    { href: "/outreach", label: "Companies to email", hint: "The companies picked each night, with their custom emails", icon: ListChecks },
    { href: "/targets", label: "Discover companies", hint: "Search, add or remove companies", icon: MagnifyingGlass },
  ] },
  { title: null, label: "Outreach", items: [
    { href: "/drafts", label: "Drafts", hint: "Review, edit and approve your emails", icon: PencilSimpleLine },
    { href: "/auto-send", label: "Auto-send", hint: "What sends next, when, and what is blocked", icon: PaperPlaneTilt },
    { href: "/activity", label: "Send history", hint: "Everything sent, and every reply", icon: ClockCounterClockwise },
  ] },
  { title: null, items: [
    { href: "/replies", label: "Replies", hint: "Everyone who wrote back, and what to do next", icon: ChatCircleText },
    { href: "/linkedin", label: "LinkedIn tasks", hint: "Messages to send by hand on LinkedIn", icon: LinkedinLogo },
    { href: "/stats", label: "Results", hint: "Replies, meetings and what's working", icon: ChartBar },
  ] },
  { title: "More", items: [
    { href: "/followups", label: "Follow-ups", hint: "What goes out after each first email", icon: ArrowsClockwise },
    { href: "/pipeline", label: "Pipeline", hint: "Conversations turning into deals", icon: TrendUp },
    { href: "/people", label: "People", hint: "Every contact on file", icon: Users },
    { href: "/roles", label: "Jobs they're hiring for", hint: "Open roles at the companies on file", icon: Briefcase },
    { href: "/posts", label: "Employee posts", hint: "What their people are posting", icon: ChatTeardropText },
  ] },
];
const bottomItems: NavItem[] = [
  { href: "/settings", label: "Settings", hint: "Gmail, signature and your team", icon: GearSix },
  { href: "/runs", label: "Research runs", hint: "Nightly research and its cost", icon: PlayCircle, adminOnly: true },
  { href: "/delivery-recovery", label: "Unsure sends", hint: "Check emails that may not have sent", icon: Lifebuoy, adminOnly: true },
];
/** Wide pages start with the sidebar folded to icons; anywhere else it is open unless she folded it. */
const FOLD_BY_DEFAULT = [/^\/outreach/, /^\/accounts\//];
const FOLD_KEY = "nw-sidebar-folded";
const FOLD_EVENT = "nw-sidebar-fold";
function readFold(): boolean | null {
  try { const saved = window.localStorage.getItem(FOLD_KEY); return saved === null ? null : saved === "1"; } catch { return null; }
}
function writeFold(folded: boolean) {
  try { window.localStorage.setItem(FOLD_KEY, folded ? "1" : "0"); } catch { /* storage blocked: the choice lasts this page only */ }
  window.dispatchEvent(new Event(FOLD_EVENT));
}
/** Which titled groups she opened; a group holding the page she is on always shows. */
const GROUPS_KEY = "nw-sidebar-groups";
function readGroups(): string {
  try { return window.localStorage.getItem(GROUPS_KEY) ?? ""; } catch { return ""; }
}
function writeGroups(open: string[]) {
  try { window.localStorage.setItem(GROUPS_KEY, open.join("|")); } catch { /* storage blocked: lasts this page only */ }
  window.dispatchEvent(new Event(FOLD_EVENT));
}
function subscribeFold(onChange: () => void) {
  window.addEventListener(FOLD_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(FOLD_EVENT, onChange); window.removeEventListener("storage", onChange); };
}

export function Header({showTour=true}:{showTour?:boolean}) {
  const pathname = usePathname();
  const active = (href: string) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`) || (href === "/outreach" && pathname.startsWith("/accounts"));
  const [counts, setCounts] = useState<{ today: number; companies: number; followups: number; replies?: number; drafts?: number; linkedin?: number } | null>(null);
  // Folded: no saved choice means "the page's default"; a choice she made is remembered on this browser.
  const foldChoice = useSyncExternalStore(subscribeFold, readFold, () => null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const folded = foldChoice ?? FOLD_BY_DEFAULT.some((pattern) => pattern.test(pathname));
  const openGroups = useSyncExternalStore(subscribeFold, readGroups, () => "").split("|").filter(Boolean);
  const toggleGroup = (title: string) => writeGroups(openGroups.includes(title) ? openGroups.filter((name) => name !== title) : [...openGroups, title]);
  const toggleFold = () => writeFold(!folded);
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

  useEffect(() => {
    let live = true;
    fetch("/api/nav-counts", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => { if (live && data) setCounts(data); }).catch(() => {});
    return () => { live = false; };
  }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    document.querySelector<HTMLElement>(".side-nav .side-link")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);
  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => { if (live && data && !data.error) setMe(data); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const meInitials = me?.name ? me.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") : "";


  const countFor = (href: string) => href === "/outreach" ? counts?.today : href === "/drafts" ? counts?.drafts : href === "/followups" ? counts?.followups : href === "/replies" ? counts?.replies : href === "/linkedin" ? counts?.linkedin : undefined;
  // A member's Results are her own sent stats; the full analytics page is for the admin.
  const hrefFor = (item: NavItem) => item.href === "/stats" && me && me.role !== "admin" ? "/drafts/sent?days=30" : item.href;
  const isActive = (item: NavItem) => active(item.href);
  const link = (item: NavItem) => {
    const Icon = item.icon;
    const count = countFor(item.href);
    return (
      <Link key={item.href} href={hrefFor(item)} onClick={() => setMobileOpen(false)} title={folded ? `${item.label}: ${item.hint}` : item.hint} className={`side-link ${isActive(item) ? "is-active" : ""}`} aria-current={isActive(item) ? "page" : undefined}>
        <Icon size={20} weight={isActive(item) ? "duotone" : "regular"} aria-hidden="true" />
        <span className="side-label">{item.label}</span>
        {count ? <b className={`side-count ${item.href === "/replies" ? "is-alert" : ""}`}>{count}</b> : null}
      </Link>
    );
  };

  return (
    <>
    <aside className={`side-nav ${folded ? "is-folded" : ""} ${mobileOpen ? "is-mobile-open" : ""}`} aria-label="Navigation">
      <div className="side-top">
        <Link href="/" className="side-brand" title="Night Watch">
          <span className="brand-moon" aria-hidden />
          <strong className="side-label">nightwatch<i>.</i></strong>
        </Link>
        <button type="button" className="side-fold" onClick={toggleFold} title={folded ? "Open the sidebar" : "Fold the sidebar to icons"} aria-label={folded ? "Open the sidebar" : "Fold the sidebar"}>{folded ? <SidebarSimple size={18} /> : <SidebarSimple size={18} />}</button>
      </div>
      <nav className="side-groups">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || me?.role === "admin");
          if (!group.title) return <div className="side-group" key={group.label}>{group.label && <span className="side-title side-label">{group.label}</span>}{items.map(link)}</div>;
          const title = group.title;
          const here = items.some(isActive);
          const open = folded || here || openGroups.includes(title);
          const waiting = items.reduce((total, item) => total + (countFor(item.href) ?? 0), 0);
          const id = `side-group-${title.replace(/\W+/g, "-").toLowerCase()}`;
          return (
            <div className={`side-group is-collapsible ${open ? "is-open" : ""}`} key={title}>
              <button type="button" className="side-group-toggle side-label" aria-expanded={open} aria-controls={id} disabled={here} onClick={() => toggleGroup(title)} title={here ? "The page you are on is in this group" : open ? `Hide ${title}` : `Show ${title}`}>
                <span>{title}</span>
                {!open && waiting > 0 && <b className="side-count">{waiting}</b>}
                <CaretDown size={15} aria-hidden="true" />
              </button>
              {open && <div id={id} className="side-group-items">{items.map(link)}</div>}
            </div>
          );
        })}
      </nav>
      <div className="side-bottom">
        {bottomItems.filter((item) => !item.adminOnly || me?.role === "admin").map(link)}
        {showTour && <Walkthrough userKey={me?.email} inSidebar />}
        <FeedbackWidget inSidebar />
        {me?.canAct && !me.actor && !me.actingError && <button type="button" className="side-link side-action" disabled={switching} onClick={() => switchAccount(false)} title="Act as Suuchi"><UserSwitch size={18} aria-hidden="true" /><span className="side-label">Act as Suuchi</span></button>}
        <div className="side-account" title={me?.email ?? "Signed in"}>
          <span className="ws-badge" aria-hidden="true">{meInitials}</span>
          <span className="side-account-who side-label"><b>{me?.name ?? ""}</b><small>{me?.email ?? ""}</small></span>
          <form action="/api/auth/logout" method="post"><button className="side-signout" type="submit" title="Sign out" aria-label="Sign out"><SignOut size={16} /></button></form>
        </div>
      </div>
    </aside>
    {mobileOpen && <button type="button" className="side-scrim" aria-label="Close the menu" onClick={() => setMobileOpen(false)} />}
    <header className="appbar" aria-label="Menu">
      <div className="appbar-left">
        <button type="button" className="appbar-menu" onClick={() => setMobileOpen(true)} aria-label="Open the menu"><List size={20} /></button>
        <Link href="/" className="appbar-brand appbar-brand-mobile" title="Night Watch"><span className="brand-moon" aria-hidden /><strong>nightwatch<i>.</i></strong></Link>
      </div>
    </header>
    {(me?.actor || me?.actingError) && <div role="status" className="act-as-bar">
      <div><strong>{me.actingError ? "Admin mode expired. Exit to continue." : `Acting as ${me.name}`}</strong>{me.actor && <div>Admin: {me.actor.name}. Sends use this account’s Gmail; test emails go to its inbox. Mode lasts one hour.</div>}</div>
      <button className="btn" disabled={switching} onClick={() => switchAccount(true)}>Exit admin mode</button>
    </div>}
    {switchError && <div role="alert" className="act-as-error">{switchError}</div>}
    </>
  );
}
