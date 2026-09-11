"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CLOSED_STAGES, STAGE_LABEL, type OutreachRow, type OutreachStage } from "@/lib/outreach";

export type BoardFilters = { q: string; priority: string; industry: string; show: string; sort: string };

const PAGE_SIZE = 50;
const WEEK_MS = 7 * 86_400_000;

/** The tabs above the table: where each company stands, from the file's point of view. */
const TABS: Array<{ value: string; label: string; test: (row: OutreachRow, now: number) => boolean }> = [
  { value: "", label: "All", test: () => true },
  { value: "drafted", label: "Draft ready", test: (row) => row.openDossiers > 0 },
  { value: "hiring", label: "Hiring", test: (row) => row.openRoles > 0 },
  { value: "posts", label: "Posting about AI", test: (row) => row.aiPosts > 0 },
  { value: "reachable", label: "Has a contact", test: (row) => row.whoReach !== "none" },
  { value: "working", label: "In progress", test: (row) => !CLOSED_STAGES.has(row.stage) && row.stage !== "untouched" },
  { value: "untouched", label: "Not started", test: (row) => row.stage === "untouched" },
  { value: "changed", label: "Changed this week", test: (row, now) => Boolean(row.lastChangeAt && now - Date.parse(row.lastChangeAt) <= WEEK_MS) },
  { value: "quiet", label: "Nothing found", test: (row) => row.intelScore === 0 && row.reasons.length === 0 },
];

const SORTS: Record<string, { label: string; compare: (a: OutreachRow, b: OutreachRow) => number }> = {
  next: { label: "Contact first", compare: (a, b) => b.rank - a.rank || b.intelScore - a.intelScore || a.name.localeCompare(b.name) },
  priority: { label: "A1 first", compare: (a, b) => a.tier.localeCompare(b.tier) || b.rank - a.rank },
  change: { label: "Recently changed", compare: (a, b) => time(b.lastChangeAt) - time(a.lastChangeAt) || b.rank - a.rank },
  name: { label: "A to Z", compare: (a, b) => a.name.localeCompare(b.name) },
};

const REACH_LABEL: Record<OutreachRow["whoReach"], string> = { verified: "email verified", email: "email on file", linkedin: "LinkedIn", none: "" };
const STAGE_TONE: Record<OutreachStage, string> = { untouched: "muted", researching: "info", ready: "info", contacted: "accent", replied: "ok", meeting: "ok", won: "ok", lost: "muted", hold: "muted" };

function time(value: string | null) {
  return value ? Date.parse(value) : 0;
}
function ago(value: string | null, now: number) {
  if (!value) return "—";
  const days = Math.floor((now - Date.parse(value)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1d ago" : days < 30 ? `${days}d ago` : days < 365 ? `${Math.round(days / 30)}mo ago` : `${Math.round(days / 365)}y ago`;
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}
function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export function OutreachBoard({ rows, heldWithSignal, initial, scan }: { rows: OutreachRow[]; heldWithSignal: number; initial: BoardFilters; scan: ReactNode }) {
  const router = useRouter();
  const [filters, setFilters] = useState<BoardFilters>(initial);
  const [page, setPage] = useState(1);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value && !(key === "sort" && value === "next")) query.set(key, value);
    const next = query.toString() ? `/outreach?${query}` : "/outreach";
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [filters]);

  const set = (patch: Partial<BoardFilters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const industries = useMemo(() => [...new Set(rows.map((row) => row.industry).filter(Boolean))].sort(), [rows]);
  const tab = TABS.find((item) => item.value === filters.show) ?? TABS[0];
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((row) =>
      (!q || [row.name, row.domain, row.industry, row.subSegment, row.hqCity, row.hqState, row.ownership, row.peSponsor, row.ceo, row.aiSignal, row.notes, row.ownerNotes, row.owner, row.who, row.why].some((value) => value.toLowerCase().includes(q))) &&
      (!filters.priority || row.tier === filters.priority) &&
      (!filters.industry || row.industry === filters.industry) &&
      tab.test(row, now)).sort((SORTS[filters.sort] ?? SORTS.next).compare);
  }, [rows, filters, tab, now]);

  const scanned = rows.filter((row) => row.careersStatus || row.lastResearchedAt).length;
  const stats = {
    drafted: rows.filter((row) => row.openDossiers > 0).length,
    hiring: rows.filter((row) => row.openRoles > 0).length,
    reachable: rows.filter((row) => row.whoReach !== "none").length,
    contacted: rows.filter((row) => row.sent > 0 || ["contacted", "replied", "meeting", "won"].includes(row.stage)).length,
    replied: rows.filter((row) => row.replied > 0 || ["replied", "meeting", "won"].includes(row.stage)).length,
    changed: rows.filter((row) => row.lastChangeAt && now - Date.parse(row.lastChangeAt) <= WEEK_MS).length,
  };
  const narrowed = Boolean(filters.q || filters.priority || filters.industry || filters.show || (filters.sort && filters.sort !== "next"));
  const first = !narrowed ? filtered[0] : undefined;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function exportCsv() {
    const header = ["rank", "priority", "company", "website", "industry", "hq", "why_now", "who", "who_title", "reach", "draft_score", "roles", "ai_posts", "people", "verified_emails", "stage", "owner", "notes", "last_change", "source_url"];
    const lines = filtered.map((row, index) => [index + 1, row.tier, row.name, row.domain, row.industry, `${row.hqCity}, ${row.hqState}`, row.why, row.who, row.whoTitle, REACH_LABEL[row.whoReach], row.draftScore || "", row.openRoles, row.aiPosts, row.contacts, row.verifiedEmails, STAGE_LABEL[row.stage], row.owner, row.ownerNotes, row.lastChangeAt?.slice(0, 10) ?? "", row.sourceUrl].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `reach-out-list-${new Date(now).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <>
    <header className="page-head">
      <div><h1>Reach-out list</h1><p>{rows.length} Tier A companies · {scanned} scanned · Night Watch scans, researches and drafts on its own. Click a company for everything on file.</p></div>
      <div className="page-actions">{scan}<button type="button" className="btn-secondary" onClick={exportCsv}>Export</button></div>
    </header>

    <section className="stat-row">
      <button type="button" className={`stat ${filters.show === "drafted" ? "is-active" : ""}`} onClick={() => set({ show: filters.show === "drafted" ? "" : "drafted" })}><span>Draft ready</span><strong>{stats.drafted}</strong><small>written and waiting</small></button>
      <button type="button" className={`stat ${filters.show === "hiring" ? "is-active" : ""}`} onClick={() => set({ show: filters.show === "hiring" ? "" : "hiring" })}><span>Hiring target roles</span><strong>{stats.hiring}</strong><small>work Nine-67 would build instead</small></button>
      <button type="button" className={`stat ${filters.show === "reachable" ? "is-active" : ""}`} onClick={() => set({ show: filters.show === "reachable" ? "" : "reachable" })}><span>Has a contact</span><strong>{stats.reachable}</strong><small>someone to write to</small></button>
      <button type="button" className={`stat ${filters.show === "changed" ? "is-active" : ""}`} onClick={() => set({ show: filters.show === "changed" ? "" : "changed" })}><span>Changed this week</span><strong>{stats.changed}</strong><small>new roles, posts or people</small></button>
      <div className="stat"><span>Contacted</span><strong>{stats.contacted}</strong><small>{stats.replied} replied</small></div>
    </section>

    {first && <Link href={`/accounts/${first.domain}`} className="card next-card">
      <div className="next-card-tag">Contact first</div>
      <div className="next-card-body">
        <div className="next-card-title"><span className="avatar">{initials(first.name)}</span><div><strong>{first.name}</strong><small>{first.industry}{first.hqState ? ` · ${first.hqCity}, ${first.hqState}` : ""} · Tier {first.tier}</small></div></div>
        <p>{first.why}</p>
        <div className="next-card-foot"><span>Write to <b>{first.who ? `${first.who}, ${first.whoTitle}` : "nobody on file yet"}</b>{REACH_LABEL[first.whoReach] ? ` · ${REACH_LABEL[first.whoReach]}` : ""}</span><span>Draft <b>{first.draftCardId ? `ready · ${first.draftScore}` : "not written yet"}</b></span><span className={`pill pill-${STAGE_TONE[first.stage]}`}><i />{STAGE_LABEL[first.stage]}</span></div>
      </div>
      <span className="btn-primary">Open</span>
    </Link>}

    <section className="card">
      <div className="tabs-row">
        <nav className="tabs" aria-label="Show">{TABS.map((item) => <button key={item.value} type="button" className={tab.value === item.value ? "is-active" : ""} onClick={() => set({ show: item.value })}>{item.label}<b>{rows.filter((row) => item.test(row, now)).length}</b></button>)}</nav>
        <div className="toolbar">
          <input value={filters.q} onChange={(event) => set({ q: event.target.value })} placeholder="Search" aria-label="Search" />
          <select value={filters.priority} onChange={(event) => set({ priority: event.target.value })} aria-label="Priority"><option value="">A1 + A2</option><option value="A1">A1</option><option value="A2">A2</option></select>
          <select value={filters.industry} onChange={(event) => set({ industry: event.target.value })} aria-label="Industry"><option value="">All industries</option>{industries.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={filters.sort} onChange={(event) => set({ sort: event.target.value })} aria-label="Sort">{Object.entries(SORTS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>
          {narrowed && <button type="button" className="btn-link" onClick={() => setFilters({ q: "", priority: "", industry: "", show: "", sort: "next" })}>Clear</button>}
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th className="col-num">#</th><th>Company</th><th>Why now</th><th>Write to</th><th>Status</th><th className="col-num">Score</th><th>Changed</th></tr></thead>
          <tbody>
            {visible.map((row, index) => <tr key={row.domain} className={CLOSED_STAGES.has(row.stage) ? "is-closed" : ""} onClick={() => router.push(`/accounts/${row.domain}`)}>
              <td className="col-num">{(current - 1) * PAGE_SIZE + index + 1}</td>
              <td><div className="cell-company"><span className="avatar">{initials(row.name)}</span><div><strong>{row.name}</strong><small>{row.industry}{row.hqState ? ` · ${row.hqCity}, ${row.hqState}` : ""} · {row.tier}</small></div></div></td>
              <td className="cell-why"><span>{row.why}</span>{row.draftCardId && <em className="pill pill-ink"><i />Draft {row.draftScore}</em>}</td>
              <td className="cell-who">{row.who ? <><strong>{row.who}</strong><small>{row.whoTitle}{REACH_LABEL[row.whoReach] ? ` · ${REACH_LABEL[row.whoReach]}` : ""}</small></> : <small>{row.contacts ? `${row.contacts} on file, none reachable` : "nobody yet"}</small>}</td>
              <td><span className={`pill pill-${STAGE_TONE[row.stage]}`}><i />{STAGE_LABEL[row.stage]}</span>{row.owner && <small className="cell-sub">{row.owner}</small>}</td>
              <td className="col-num"><b className={`score ${row.intelScore >= 60 ? "is-hot" : row.intelScore >= 30 ? "is-warm" : ""}`}>{row.intelScore}</b></td>
              <td className="cell-time">{ago(row.lastChangeAt, now)}</td>
            </tr>)}
            {visible.length === 0 && <tr><td colSpan={7} className="cell-empty">Nothing matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="table-foot">
        <span>{filtered.length ? ((current - 1) * PAGE_SIZE + 1).toLocaleString() : 0}–{Math.min(current * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span>
        <div>{current > 1 && <button type="button" className="btn-secondary" onClick={() => setPage(current - 1)}>Previous</button>}{current < totalPages && <button type="button" className="btn-secondary" onClick={() => setPage(current + 1)}>Next</button>}</div>
      </footer>
    </section>

    {heldWithSignal > 0 && <p className="page-note">{heldWithSignal} held {heldWithSignal === 1 ? "company" : "companies"} (Tier B or C) now {heldWithSignal === 1 ? "shows" : "show"} a signal. <Link href="/targets?tier=hold">See them</Link> and put any on the list from its page.</p>}
  </>;
}
