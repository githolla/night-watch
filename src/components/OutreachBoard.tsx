"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CLOSED_STAGES, STAGE_LABEL, type OutreachRow } from "@/lib/outreach";

export type BoardFilters = { q: string; priority: string; industry: string; show: string; sort: string };

const PAGE_SIZE = 50;
const WEEK_MS = 7 * 86_400_000;

const SHOW: Record<string, { label: string; test: (row: OutreachRow, now: number) => boolean }> = {
  "": { label: "Everyone", test: () => true },
  drafted: { label: "Draft ready", test: (row) => row.openDossiers > 0 },
  hiring: { label: "Hiring target roles", test: (row) => row.openRoles > 0 },
  posts: { label: "Posting about AI", test: (row) => row.aiPosts > 0 },
  reachable: { label: "Has someone to write to", test: (row) => row.whoReach !== "none" },
  changed: { label: "Changed this week", test: (row, now) => Boolean(row.lastChangeAt && now - Date.parse(row.lastChangeAt) <= WEEK_MS) },
  untouched: { label: "Not started", test: (row) => row.stage === "untouched" },
  working: { label: "In progress", test: (row) => !CLOSED_STAGES.has(row.stage) && row.stage !== "untouched" },
  contacted: { label: "Contacted", test: (row) => row.sent > 0 || ["contacted", "replied", "meeting", "won"].includes(row.stage) },
  quiet: { label: "Nothing found yet", test: (row) => row.intelScore === 0 && row.reasons.length === 0 },
};

const SORTS: Record<string, { label: string; compare: (a: OutreachRow, b: OutreachRow) => number }> = {
  next: { label: "Contact first", compare: (a, b) => b.rank - a.rank || b.intelScore - a.intelScore || a.name.localeCompare(b.name) },
  priority: { label: "A1 first", compare: (a, b) => a.tier.localeCompare(b.tier) || b.rank - a.rank },
  change: { label: "Recently changed", compare: (a, b) => time(b.lastChangeAt) - time(a.lastChangeAt) || b.rank - a.rank },
  name: { label: "A to Z", compare: (a, b) => a.name.localeCompare(b.name) },
};

const REACH_LABEL: Record<OutreachRow["whoReach"], string> = { verified: "email verified", email: "email on file", linkedin: "LinkedIn", none: "" };

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
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const show = SHOW[filters.show] ?? SHOW[""];
    return rows.filter((row) =>
      (!q || [row.name, row.domain, row.industry, row.subSegment, row.hqCity, row.hqState, row.ownership, row.peSponsor, row.ceo, row.aiSignal, row.notes, row.ownerNotes, row.owner, row.who, row.why].some((value) => value.toLowerCase().includes(q))) &&
      (!filters.priority || row.tier === filters.priority) &&
      (!filters.industry || row.industry === filters.industry) &&
      show.test(row, now)).sort((SORTS[filters.sort] ?? SORTS.next).compare);
  }, [rows, filters, now]);

  const scanned = rows.filter((row) => row.careersStatus || row.lastResearchedAt).length;
  const narrowed = Boolean(filters.q || filters.priority || filters.industry || filters.show || (filters.sort && filters.sort !== "next"));
  const first = !narrowed ? filtered[0] : undefined;
  const listRows = first ? filtered.slice(1) : filtered;
  const totalPages = Math.max(1, Math.ceil(listRows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = listRows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const offset = (first ? 1 : 0) + (current - 1) * PAGE_SIZE;

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
    <section className="targets-head has-hero hero-slim">
      <div>
        <span className="eyebrow">Reach-out list · Tier A · {rows.length} companies · {scanned} scanned · {rows.filter((row) => row.openDossiers > 0).length} with a draft ready</span>
        {scan}
      </div>
    </section>

    {first && <Link href={`/accounts/${first.domain}`} className="next-up">
      <div className="next-up-rank"><span>Contact first</span><strong>01</strong></div>
      <div className="next-up-body">
        <div className="next-up-title"><h1>{first.name}</h1><span className={`tier-chip tier-${first.tier}`}>{first.tier}</span><span className="next-up-meta">{first.industry}{first.hqState ? ` · ${first.hqCity}, ${first.hqState}` : ""}</span></div>
        <ul className="next-up-why">{(first.reasons.length ? first.reasons : [first.why]).map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        <div className="next-up-foot">
          <span><b>Write to</b> {first.who ? `${first.who}, ${first.whoTitle}${REACH_LABEL[first.whoReach] ? ` · ${REACH_LABEL[first.whoReach]}` : ""}` : "nobody on file yet"}</span>
          <span><b>Draft</b> {first.draftCardId ? `ready, score ${first.draftScore}` : "not written yet"}</span>
          <span><b>Status</b> {STAGE_LABEL[first.stage]}{first.owner ? ` · ${first.owner}` : ""}</span>
        </div>
      </div>
      <div className="next-up-go">Open →</div>
    </Link>}

    <section className="target-results">
      <header>
        <div><span className="eyebrow">{narrowed ? "Narrowed" : "Then, in order"}</span><h2>{filtered.length.toLocaleString()} {filtered.length === 1 ? "company" : "companies"}</h2></div>
        <div className="outreach-results-actions"><button type="button" className="outreach-clear" onClick={exportCsv}>Export CSV</button>{narrowed && <button type="button" className="outreach-clear" onClick={() => setFilters({ q: "", priority: "", industry: "", show: "", sort: "next" })}>Clear</button>}</div>
      </header>
      <div className="reach-filters">
        <input value={filters.q} onChange={(event) => set({ q: event.target.value })} placeholder="Search a company, person, industry, city…" aria-label="Search" />
        <select value={filters.priority} onChange={(event) => set({ priority: event.target.value })} aria-label="Priority"><option value="">A1 and A2</option><option value="A1">A1 only</option><option value="A2">A2 only</option></select>
        <select value={filters.industry} onChange={(event) => set({ industry: event.target.value })} aria-label="Industry"><option value="">All industries</option>{industries.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.show} onChange={(event) => set({ show: event.target.value })} aria-label="Show">{Object.entries(SHOW).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>
        <select value={filters.sort} onChange={(event) => set({ sort: event.target.value })} aria-label="Sort">{Object.entries(SORTS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>
      </div>
      <ol className="rank-list">
        {visible.map((row, index) => {
          const changedRecently = row.lastChangeAt && now - Date.parse(row.lastChangeAt) <= WEEK_MS;
          return <li key={row.domain} className={CLOSED_STAGES.has(row.stage) ? "is-closed" : ""} onClick={() => router.push(`/accounts/${row.domain}`)}>
            <span className="rank-num">{String(offset + index + 1).padStart(2, "0")}</span>
            <div className="rank-company"><strong>{row.name}</strong><small>{row.industry}{row.hqState ? ` · ${row.hqCity}, ${row.hqState}` : ""}</small><span className="outreach-chips"><span className={`tier-chip tier-${row.tier}`}>{row.tier}</span>{row.draftCardId && <span className="tier-chip tier-draft">Draft {row.draftScore}</span>}</span></div>
            <div className="rank-why"><p>{row.why}</p><small>{row.who ? `Write to ${row.who}, ${row.whoTitle}${REACH_LABEL[row.whoReach] ? ` · ${REACH_LABEL[row.whoReach]}` : ""}` : row.contacts ? `${row.contacts} people on file, none reachable yet` : "Nobody on file yet"}</small></div>
            <div className="rank-status"><span>{STAGE_LABEL[row.stage]}</span><small>{row.owner || ""}{row.owner && row.lastChangeAt ? " · " : ""}{row.lastChangeAt ? <b className={changedRecently ? "outreach-changed" : ""}>changed {shortDate(row.lastChangeAt)}</b> : ""}</small></div>
            <span className="rank-go">→</span>
          </li>;
        })}
        {visible.length === 0 && <li className="outreach-empty">Nothing matches.</li>}
      </ol>
      <nav className="target-pagination" aria-label="Pages">
        {current > 1 ? <button type="button" className="outreach-page" onClick={() => setPage(current - 1)}>← Previous</button> : <span />}
        <span>{listRows.length ? ((current - 1) * PAGE_SIZE + 1).toLocaleString() : 0}–{Math.min(current * PAGE_SIZE, listRows.length).toLocaleString()} of {listRows.length.toLocaleString()}</span>
        {current < totalPages ? <button type="button" className="outreach-page" onClick={() => setPage(current + 1)}>Next →</button> : <span />}
      </nav>
    </section>

    {heldWithSignal > 0 && <p className="coverage-note reach-held">{heldWithSignal} held {heldWithSignal === 1 ? "company" : "companies"} (Tier B or C) now {heldWithSignal === 1 ? "shows" : "show"} a signal. <Link href="/targets?tier=hold">See them</Link> and put any on the list from its page.</p>}
  </>;
}
