"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CLOSED_STAGES, STAGE_LABEL, type OutreachRow, type OutreachStage } from "@/lib/outreach";

export type ReachOutResult = { cardId: string; domain: string; company: string; tier: string; score: number; whyNow: string; channel: string; person: string; title: string; stage: OutreachStage; owner: string };

export type BoardFilters = { q: string; priority: string; industry: string; show: string; sort: string };

const PAGE_SIZE = 50;
const WEEK_MS = 7 * 86_400_000;

/** One dropdown narrows the list by what the scan found or where the work stands. */
const SHOW: Record<string, { label: string; test: (row: OutreachRow, now: number) => boolean }> = {
  "": { label: "Everything", test: () => true },
  drafted: { label: "Outreach drafted", test: (row) => row.openDossiers > 0 },
  hiring: { label: "Hiring in target roles", test: (row) => row.openRoles > 0 },
  posts: { label: "Posting about AI", test: (row) => row.aiPosts > 0 },
  contacts: { label: "Has a contact", test: (row) => row.contacts > 0 },
  changed: { label: "Changed this week", test: (row, now) => Boolean(row.lastChangeAt && now - Date.parse(row.lastChangeAt) <= WEEK_MS) },
  working: { label: "Being worked", test: (row) => !CLOSED_STAGES.has(row.stage) && row.stage !== "untouched" },
  contacted: { label: "Contacted", test: (row) => row.sent > 0 || ["contacted", "replied", "meeting", "won"].includes(row.stage) },
  untouched: { label: "Not started", test: (row) => row.stage === "untouched" },
  quiet: { label: "Nothing found yet", test: (row) => row.intelScore === 0 },
};

const SORTS: Record<string, { label: string; compare: (a: OutreachRow, b: OutreachRow) => number }> = {
  intel: { label: "Strongest first", compare: (a, b) => b.intelScore - a.intelScore || time(b.lastChangeAt) - time(a.lastChangeAt) || a.name.localeCompare(b.name) },
  priority: { label: "A1 first", compare: (a, b) => a.tier.localeCompare(b.tier) || b.intelScore - a.intelScore || a.name.localeCompare(b.name) },
  change: { label: "Recently changed", compare: (a, b) => time(b.lastChangeAt) - time(a.lastChangeAt) || b.intelScore - a.intelScore },
  name: { label: "A to Z", compare: (a, b) => a.name.localeCompare(b.name) },
};

function time(value: string | null) {
  return value ? Date.parse(value) : 0;
}
function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export function OutreachBoard({ rows, results, heldWithSignal, initial, scan }: { rows: OutreachRow[]; results: ReachOutResult[]; heldWithSignal: number; initial: BoardFilters; scan: ReactNode }) {
  const router = useRouter();
  const [filters, setFilters] = useState<BoardFilters>(initial);
  const [page, setPage] = useState(1);
  const [now] = useState(() => Date.now());

  // Filters live in the address bar, so a view can be sent to the other person as a link.
  useEffect(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value && !(key === "sort" && value === "intel")) query.set(key, value);
    const next = query.toString() ? `/outreach?${query}` : "/outreach";
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [filters]);

  const set = (patch: Partial<BoardFilters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };

  const industries = useMemo(() => [...new Set(rows.map((row) => row.industry).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const show = SHOW[filters.show] ?? SHOW[""];
    return rows
      .filter((row) =>
        (!q || [row.name, row.domain, row.industry, row.subSegment, row.hqCity, row.hqState, row.ownership, row.peSponsor, row.ceo, row.aiSignal, row.notes, row.ownerNotes, row.owner].some((value) => value.toLowerCase().includes(q))) &&
        (!filters.priority || row.tier === filters.priority) &&
        (!filters.industry || row.industry === filters.industry) &&
        show.test(row, now))
      .sort((SORTS[filters.sort] ?? SORTS.intel).compare);
  }, [rows, filters, now]);

  const scanned = rows.filter((row) => row.careersStatus || row.lastResearchedAt).length;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const narrowed = Boolean(filters.q || filters.priority || filters.industry || filters.show);

  function exportCsv() {
    const header = ["priority", "company", "website", "industry", "sub_segment", "hq_city", "hq_state", "ownership", "pe_sponsor", "revenue_band", "employees", "ceo", "likely_buyer_titles", "ai_signal", "score", "open_target_roles", "ai_posts", "contacts", "verified_emails", "drafted", "sent", "replied", "meetings", "stage", "owner", "notes", "last_change", "source_url"];
    const lines = filtered.map((row) => [row.tier, row.name, row.domain, row.industry, row.subSegment, row.hqCity, row.hqState, row.ownership, row.peSponsor, row.revenueBand, row.employees, row.ceo, row.targetTitles.join("; "), row.aiSignal, row.intelScore, row.openRoles, row.aiPosts, row.contacts, row.verifiedEmails, row.openDossiers, row.sent, row.replied, row.meetings, STAGE_LABEL[row.stage], row.owner, row.ownerNotes, row.lastChangeAt?.slice(0, 10) ?? "", row.sourceUrl].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `reach-out-list-${new Date(now).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <>
    <section className="targets-head has-hero">
      <div>
        <span className="eyebrow">Reach-out list · Tier A</span>
        <h1>{results.length ? `${results.length} ${results.length === 1 ? "reason" : "reasons"} to reach out.` : scanned ? "Nothing ready to send yet." : "Scanning your list."}</h1>
        <p>{rows.length} companies. Night Watch scans only these, on its own, and drafts the outreach when it finds a real reason. Click any company for everything on file.</p>
        {scan}
      </div>
      <div className="targets-head-count"><span>SCANNED</span><strong>{scanned.toLocaleString()} / {rows.length.toLocaleString()}</strong><small>{rows.filter((row) => row.openRoles > 0).length} hiring in target roles · {rows.filter((row) => row.aiPosts > 0).length} posting about AI · {rows.filter((row) => row.contacts > 0).length} with a contact</small><small>{rows.filter(SHOW.contacted.test).length} contacted · {rows.filter((row) => row.replied > 0 || ["replied", "meeting", "won"].includes(row.stage)).length} replied</small></div>
    </section>

    <section className="target-results reach-results">
      <header><div><span className="eyebrow">Reach out now</span><h2>{results.length ? `${results.length} drafted and waiting` : "Nothing drafted yet"}</h2></div>{results.length > 0 && <Link href="/desk" className="outreach-open">Work them on the desk →</Link>}</header>
      {results.length ? <ol className="reach-list">{results.slice(0, 25).map((result) => <li key={result.cardId} onClick={() => router.push(`/accounts/${result.domain}`)}>
        <div className="reach-score"><strong className={`intel-score ${result.score >= 75 ? "is-hot" : "is-warm"}`}>{result.score}</strong></div>
        <div className="reach-body">
          <div><span className="reach-company">{result.company}</span><span className={`tier-chip tier-${result.tier}`}>{result.tier}</span>{result.person && <span className="reach-person">{result.person}{result.title ? `, ${result.title}` : ""}</span>}</div>
          <p>{result.whyNow}</p>
          <small>{STAGE_LABEL[result.stage]}{result.owner ? ` · ${result.owner}` : ""}</small>
        </div>
        <Link href={`/desk?card=${result.cardId}&account=${result.domain}`} className="btn primary reach-open" onClick={(event) => event.stopPropagation()}>Open the draft</Link>
      </li>)}</ol>
      : <p className="coverage-note account-empty">{scanned ? "No company has a signal worth a draft yet. The list below ranks everyone by what was found." : "Results appear here as they are found."}</p>}
      {results.length > 25 && <p className="coverage-note account-empty">{results.length - 25} more on the <Link href="/desk">desk</Link>.</p>}
    </section>

    <section className="target-results">
      <header>
        <div><span className="eyebrow">Every company on the list</span><h2>{filtered.length.toLocaleString()} {filtered.length === 1 ? "company" : "companies"}</h2></div>
        <div className="outreach-results-actions"><button type="button" className="outreach-clear" onClick={exportCsv}>Export CSV</button>{narrowed && <button type="button" className="outreach-clear" onClick={() => setFilters({ q: "", priority: "", industry: "", show: "", sort: "intel" })}>Clear</button>}</div>
      </header>
      <div className="reach-filters">
        <input value={filters.q} onChange={(event) => set({ q: event.target.value })} placeholder="Search a company, industry, city, CEO, owner…" aria-label="Search" />
        <select value={filters.priority} onChange={(event) => set({ priority: event.target.value })} aria-label="Priority"><option value="">A1 and A2</option><option value="A1">A1 only</option><option value="A2">A2 only</option></select>
        <select value={filters.industry} onChange={(event) => set({ industry: event.target.value })} aria-label="Industry"><option value="">All industries</option>{industries.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.show} onChange={(event) => set({ show: event.target.value })} aria-label="Show">{Object.entries(SHOW).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>
        <select value={filters.sort} onChange={(event) => set({ sort: event.target.value })} aria-label="Sort">{Object.entries(SORTS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>
      </div>
      <div className="target-table-wrap">
        <table className="target-directory-table reach-table">
          <thead><tr><th>Company</th><th>Priority</th><th>Found</th><th>Drafted</th><th>Status</th><th>Changed</th></tr></thead>
          <tbody>
            {visible.map((row) => {
              const changedRecently = row.lastChangeAt && now - Date.parse(row.lastChangeAt) <= WEEK_MS;
              return <tr key={row.domain} className={CLOSED_STAGES.has(row.stage) ? "is-closed" : ""} onClick={() => router.push(`/accounts/${row.domain}`)}>
                <td><strong>{row.name}</strong><span>{row.industry}{row.hqState ? ` · ${row.hqCity}, ${row.hqState}` : ""}</span>{row.aiSignal && <small>{row.aiSignal}</small>}</td>
                <td><span className={`tier-chip tier-${row.tier}`}>{row.tier}</span></td>
                <td className="intel-cell"><strong className={`intel-score ${row.intelScore >= 60 ? "is-hot" : row.intelScore >= 30 ? "is-warm" : ""}`}>{row.intelScore}</strong><small>{[row.openRoles ? `${row.openRoles} roles` : null, row.aiPosts ? `${row.aiPosts} AI posts` : null, row.contacts ? `${row.contacts} contacts` : null].filter(Boolean).join(" · ") || (row.careersStatus || row.lastResearchedAt ? "nothing yet" : "not scanned")}</small></td>
                <td><span>{row.openDossiers ? `${row.openDossiers} ready` : "—"}</span>{row.sent > 0 && <small>{row.sent} sent{row.replied ? ` · ${row.replied} replied` : ""}</small>}</td>
                <td><span>{STAGE_LABEL[row.stage]}</span>{row.owner && <small>{row.owner}</small>}</td>
                <td><span className={changedRecently ? "outreach-changed" : ""}>{shortDate(row.lastChangeAt) || "—"}</span></td>
              </tr>;
            })}
            {visible.length === 0 && <tr><td colSpan={6} className="outreach-empty">Nothing matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <nav className="target-pagination" aria-label="Pages">
        {current > 1 ? <button type="button" className="outreach-page" onClick={() => setPage(current - 1)}>← Previous</button> : <span />}
        <span>{filtered.length ? ((current - 1) * PAGE_SIZE + 1).toLocaleString() : 0}–{Math.min(current * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span>
        {current < totalPages ? <button type="button" className="outreach-page" onClick={() => setPage(current + 1)}>Next →</button> : <span />}
      </nav>
    </section>

    {heldWithSignal > 0 && <p className="coverage-note reach-held">{heldWithSignal} held {heldWithSignal === 1 ? "company" : "companies"} (Tier B or C) now {heldWithSignal === 1 ? "shows" : "show"} a signal. <Link href="/targets?tier=hold">See them</Link> and put any on the list from its page.</p>}
  </>;
}
