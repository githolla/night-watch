"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CLOSED_STAGES, OUTREACH_STAGES, STAGE_LABEL, type OutreachRow, type OutreachStage } from "@/lib/outreach";

export type ReachOutResult = { cardId: string; domain: string; company: string; tier: string; score: number; whyNow: string; channel: string; person: string; title: string; stage: OutreachStage; owner: string };

export type BoardFilters = { q: string; priority: string; industry: string; ownership: string; state: string; stage: string; owner: string; data: string; sort: string };

const PAGE_SIZE = 50;
const WEEK_MS = 7 * 86_400_000;

/** Evidence filters: each one is a tile at the top, and a way to narrow the list. */
const DATA_FILTERS: Record<string, { label: string; test: (row: OutreachRow, now: number) => boolean }> = {
  hiring: { label: "Hiring in target roles", test: (row) => row.openRoles > 0 },
  posts: { label: "AI posts found", test: (row) => row.aiPosts > 0 },
  contacts: { label: "Contacts on file", test: (row) => row.contacts > 0 },
  verified: { label: "Verified email on file", test: (row) => row.verifiedEmails > 0 },
  dossier: { label: "Dossier ready", test: (row) => row.openDossiers > 0 },
  contacted: { label: "Contacted", test: (row) => row.sent > 0 || ["contacted", "replied", "meeting", "won"].includes(row.stage) },
  replied: { label: "Replied", test: (row) => row.replied > 0 || ["replied", "meeting", "won"].includes(row.stage) },
  changed: { label: "Changed this week", test: (row, now) => Boolean(row.lastChangeAt && now - Date.parse(row.lastChangeAt) <= WEEK_MS) },
  never: { label: "Nothing found yet", test: (row) => row.intelScore === 0 && !row.lastResearchedAt },
  unresearched: { label: "Not researched by the model yet", test: (row) => !row.lastResearchedAt },
  unassigned: { label: "No owner", test: (row) => !row.owner },
  working: { label: "In progress", test: (row) => !CLOSED_STAGES.has(row.stage) && row.stage !== "untouched" },
  unsynced: { label: "Not synced to the database", test: (row) => !row.synced },
};

const SORTS: Record<string, { label: string; compare: (a: OutreachRow, b: OutreachRow) => number }> = {
  intel: { label: "Intelligence score", compare: (a, b) => b.intelScore - a.intelScore || time(b.lastChangeAt) - time(a.lastChangeAt) || a.name.localeCompare(b.name) },
  priority: { label: "Priority, then score", compare: (a, b) => a.tier.localeCompare(b.tier) || b.intelScore - a.intelScore || a.name.localeCompare(b.name) },
  change: { label: "Most recently changed", compare: (a, b) => time(b.lastChangeAt) - time(a.lastChangeAt) || b.intelScore - a.intelScore },
  roles: { label: "Open target roles", compare: (a, b) => b.openRoles - a.openRoles || b.intelScore - a.intelScore },
  dossiers: { label: "Dossiers ready", compare: (a, b) => b.openDossiers - a.openDossiers || b.topDossierScore - a.topDossierScore || b.intelScore - a.intelScore },
  stage: { label: "Stage", compare: (a, b) => stageIndex(a.stage) - stageIndex(b.stage) || b.intelScore - a.intelScore },
  name: { label: "Name", compare: (a, b) => a.name.localeCompare(b.name) },
};

function time(value: string | null) {
  return value ? Date.parse(value) : 0;
}
function stageIndex(stage: OutreachStage) {
  return OUTREACH_STAGES.findIndex(([value]) => value === stage);
}
function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
function countBy<T>(items: T[], key: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export function OutreachBoard({ rows: initialRows, results, holdCandidates, initial, cut, unsynced, scan }: { rows: OutreachRow[]; results: ReachOutResult[]; holdCandidates: OutreachRow[]; initial: BoardFilters; cut: { label: string; file: string; importedAt: string }; unsynced: number; scan: ReactNode }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState<BoardFilters>(initial);
  const [page, setPage] = useState(1);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<string | null>(null);
  const [showHold, setShowHold] = useState(false);

  // The server re-renders after a promotion or a sync; take its rows (state adjusted during render, not in an effect).
  const [seenRows, setSeenRows] = useState(initialRows);
  if (seenRows !== initialRows) {
    setSeenRows(initialRows);
    setRows(initialRows);
  }

  // Filters live in the address bar, so a view can be sent to the other person as a link.
  useEffect(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value && !(key === "sort" && value === "intel")) query.set(key, value);
    const next = query.toString() ? `/outreach?${query}` : "/outreach";
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [filters]);

  const set = (patch: Partial<BoardFilters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const toggle = (key: keyof BoardFilters, value: string) => set({ [key]: filters[key] === value ? "" : value } as Partial<BoardFilters>);

  const owners = useMemo(() => {
    const names = new Set<string>(["Josh", "Jenna"]);
    for (const row of rows) if (row.owner) names.add(row.owner);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const dataFilter = DATA_FILTERS[filters.data];
    const list = rows.filter((row) =>
      (!q || [row.name, row.domain, row.industry, row.subSegment, row.hqCity, row.hqState, row.ownership, row.peSponsor, row.ceo, row.aiSignal, row.notes, row.ownerNotes, row.owner, row.targetTitles.join(" ")].some((value) => value.toLowerCase().includes(q))) &&
      (!filters.priority || row.tier === filters.priority) &&
      (!filters.industry || row.industry === filters.industry) &&
      (!filters.ownership || row.ownership === filters.ownership) &&
      (!filters.state || row.hqState === filters.state) &&
      (!filters.stage || row.stage === filters.stage) &&
      (!filters.owner || (filters.owner === "none" ? !row.owner : row.owner === filters.owner)) &&
      (!dataFilter || dataFilter.test(row, now)),
    );
    return list.sort((SORTS[filters.sort] ?? SORTS.intel).compare);
  }, [rows, filters, now]);

  const totals = useMemo(() => ({
    all: rows.length,
    a1: rows.filter((row) => row.tier === "A1").length,
    a2: rows.filter((row) => row.tier === "A2").length,
    manual: rows.filter((row) => row.manual).length,
    careersRead: rows.filter((row) => row.careersStatus).length,
    researched: rows.filter((row) => row.lastResearchedAt).length,
    hiring: rows.filter((row) => row.openRoles > 0).length,
    roles: rows.reduce((sum, row) => sum + row.openRoles, 0),
    posts: rows.filter((row) => row.aiPosts > 0).length,
    contacts: rows.filter((row) => row.contacts > 0).length,
    verified: rows.filter((row) => row.verifiedEmails > 0).length,
    dossiers: rows.filter((row) => row.openDossiers > 0).length,
    contacted: rows.filter(DATA_FILTERS.contacted.test).length,
    replied: rows.filter(DATA_FILTERS.replied.test).length,
    meetings: rows.filter((row) => row.meetings > 0 || row.stage === "meeting" || row.stage === "won").length,
    changed: rows.filter((row) => DATA_FILTERS.changed.test(row, now)).length,
    working: rows.filter(DATA_FILTERS.working.test).length,
  }), [rows, now]);

  const facets = useMemo(() => ({
    industry: countBy(rows, (row) => row.industry),
    ownership: countBy(rows, (row) => row.ownership),
    state: countBy(rows, (row) => row.hqState).slice(0, 12),
    stage: OUTREACH_STAGES.map(([value, label]) => [value, label, rows.filter((row) => row.stage === value).length] as const).filter(([, , count]) => count > 0),
    owner: countBy(rows, (row) => row.owner || "none"),
  }), [rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const active = Object.entries(filters).filter(([key, value]) => value && !(key === "sort" && value === "intel"));

  async function patch(row: OutreachRow, payload: Record<string, unknown>) {
    if (!row.id) { setError(`${row.name} is not in the database yet. Sync the target list on the Accounts page first.`); return; }
    setBusy(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${row.id}/outreach`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const json = (await response.json().catch(() => ({}))) as { error?: string; outreach_stage?: string; outreach_owner?: string | null; outreach_notes?: string | null; outreach_updated_at?: string | null; outreach?: boolean };
      if (!response.ok) throw new Error(json.error ?? `Update failed (${response.status})`);
      if (json.outreach === false) {
        setRows((current) => current.filter((item) => item.id !== row.id));
      } else {
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, stage: (json.outreach_stage as OutreachStage) ?? item.stage, owner: json.outreach_owner ?? "", ownerNotes: json.outreach_notes ?? "", stageUpdatedAt: json.outreach_updated_at ?? item.stageUpdatedAt } : item));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function promote(row: OutreachRow) {
    if (!row.id) return;
    setBusy(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${row.id}/outreach`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ outreach: true }) });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? `Update failed (${response.status})`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  function chooseOwner(row: OutreachRow, value: string) {
    if (value === "__new") {
      const name = window.prompt("Owner's name");
      if (name?.trim()) void patch(row, { outreach_owner: name.trim() });
      return;
    }
    void patch(row, { outreach_owner: value || null });
  }

  function exportCsv() {
    const header = ["priority", "company", "website", "industry", "sub_segment", "hq_city", "hq_state", "ownership", "pe_sponsor", "revenue_band", "employees", "ceo", "likely_buyer_titles", "ai_signal", "intel_score", "open_target_roles", "ai_posts", "contacts", "verified_emails", "dossiers_open", "sent", "replied", "meetings", "stage", "owner", "owner_notes", "last_change", "last_researched", "source_url"];
    const lines = filtered.map((row) => [row.tier, row.name, row.domain, row.industry, row.subSegment, row.hqCity, row.hqState, row.ownership, row.peSponsor, row.revenueBand, row.employees, row.ceo, row.targetTitles.join("; "), row.aiSignal, row.intelScore, row.openRoles, row.aiPosts, row.contacts, row.verifiedEmails, row.openDossiers, row.sent, row.replied, row.meetings, STAGE_LABEL[row.stage], row.owner, row.ownerNotes, row.lastChangeAt?.slice(0, 10) ?? "", row.lastResearchedAt?.slice(0, 10) ?? "", row.sourceUrl].map(csvCell).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reach-out-list-${new Date(now).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const tile = (key: string, label: string, value: number, note: string, tone?: string) => (
    <button type="button" key={key} className={`coverage-tile outreach-tile ${tone ?? ""} ${filters.data === key ? "is-active" : ""}`} onClick={() => toggle("data", key)}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <small>{note}</small>
      <i className="coverage-bar"><b style={{ width: `${totals.all ? Math.round((value / totals.all) * 100) : 0}%` }} /></i>
    </button>
  );

  return <>
    <section className="targets-head has-hero">
      <div>
        <span className="eyebrow">Reach-out list · {cut.label}</span>
        <h1>{results.length ? `${results.length} ${results.length === 1 ? "reason" : "reasons"} to reach out.` : totals.careersRead ? "Scanned. Nothing ready to send yet." : "Your list is in. Scan it."}</h1>
        <p>{totals.all} Tier A companies ({totals.a1} first wave, {totals.a2} second wave{totals.manual ? `, ${totals.manual} added by hand` : ""}). Night Watch scans only these: careers pages and job boards for roles Nine-67 could do instead, people posting about AI, contacts, and the public web for managers asking for help. What it finds lands below, strongest first, with the outreach drafted.</p>
        {scan}
      </div>
      <div className="targets-head-count"><span>SCANNED SO FAR</span><strong>{totals.careersRead.toLocaleString()} / {totals.all.toLocaleString()}</strong><small>{totals.researched} researched by the model · {totals.hiring} hiring in target roles · {totals.posts} posting about AI · {totals.verified} verified emails</small><small>{totals.contacted} contacted · {totals.replied} replied · {totals.meetings} meetings</small></div>
    </section>

    {unsynced > 0 && <p className="notice error">{unsynced} of the reach-out companies could not be written to the database. Reload once; if it persists, the error page will say why.</p>}
    {error && <p className="notice error">{error}</p>}

    <section className="target-results reach-results">
      <header><div><span className="eyebrow">Reach out now</span><h2>{results.length ? `${results.length} drafted and waiting` : "Nothing drafted yet"}</h2></div>{results.length > 0 && <Link href="/desk" className="outreach-open">Work them on the desk →</Link>}</header>
      {results.length ? <ol className="reach-list">{results.slice(0, 25).map((result) => <li key={result.cardId}>
        <div className="reach-score"><strong className={`intel-score ${result.score >= 75 ? "is-hot" : "is-warm"}`}>{result.score}</strong></div>
        <div className="reach-body">
          <div><Link href={`/accounts/${result.domain}`} className="reach-company">{result.company}</Link><span className={`tier-chip tier-${result.tier}`}>{result.tier}</span>{result.person && <span className="reach-person">{result.person}{result.title ? `, ${result.title}` : ""}</span>}</div>
          <p>{result.whyNow}</p>
          <small>{STAGE_LABEL[result.stage]}{result.owner ? ` · ${result.owner}` : ""} · {result.channel.replace(/_/g, " ")}</small>
        </div>
        <Link href={`/desk?card=${result.cardId}&account=${result.domain}`} className="btn primary reach-open">Open the draft</Link>
      </li>)}</ol>
      : <p className="coverage-note account-empty">{totals.careersRead ? "The scan found no company with a signal worth a draft yet. Companies with roles, posts or contacts on file are ranked in the list below." : "Press Scan above. Results appear here as they are found; you do not need to wait for the whole pass."}</p>}
      {results.length > 25 && <p className="coverage-note account-empty">{results.length - 25} more on the <Link href="/desk">desk</Link>.</p>}
    </section>

    <div className="outreach-tiles">
      {tile("unresearched", "Baseline coverage", totals.careersRead, `${totals.careersRead} careers pages read · ${totals.researched} researched by the model`, totals.careersRead === totals.all ? "is-ok" : "")}
      {tile("hiring", "Hiring in target roles", totals.hiring, `${totals.roles.toLocaleString()} open roles Nine-67 could do instead`, "is-ok")}
      {tile("posts", "AI posts", totals.posts, "companies where someone posted about AI", "is-ok")}
      {tile("verified", "Verified emails", totals.verified, `${totals.contacts} companies with any contact on file`, "is-ok")}
      {tile("dossier", "Dossiers ready", totals.dossiers, "drafted outreach waiting on the desk", "is-ok")}
      {tile("contacted", "Contacted", totals.contacted, `${totals.replied} replied · ${totals.meetings} meetings`)}
      {tile("changed", "Changed this week", totals.changed, "new roles, posts, or people since last week")}
      {tile("unassigned", "No owner yet", rows.filter(DATA_FILTERS.unassigned.test).length, "pick who works each company")}
    </div>

    <details className="outreach-facets">
      <summary><span className="eyebrow">Breakdown</span> Industry, ownership, state, stage and owner. Click any bar to narrow the list.</summary>
      <div className="outreach-facet-grid">
        <Facet title="Industry" items={facets.industry.map(([value, count]) => [value, value, count])} selected={filters.industry} total={totals.all} onPick={(value) => toggle("industry", value)} />
        <Facet title="Ownership" items={facets.ownership.map(([value, count]) => [value, value, count])} selected={filters.ownership} total={totals.all} onPick={(value) => toggle("ownership", value)} />
        <Facet title="State" items={facets.state.map(([value, count]) => [value, value, count])} selected={filters.state} total={totals.all} onPick={(value) => toggle("state", value)} />
        <Facet title="Stage" items={facets.stage.map(([value, label, count]) => [value, label, count])} selected={filters.stage} total={totals.all} onPick={(value) => toggle("stage", value)} />
        <Facet title="Owner" items={facets.owner.map(([value, count]) => [value, value === "none" ? "Unassigned" : value, count])} selected={filters.owner} total={totals.all} onPick={(value) => toggle("owner", value)} />
      </div>
    </details>

    <div className="target-filters outreach-filters">
      <label><span>Search</span><input value={filters.q} onChange={(event) => set({ q: event.target.value })} placeholder="Company, domain, industry, city, CEO, sponsor, AI signal, notes, owner" /></label>
      <label><span>Priority</span><select value={filters.priority} onChange={(event) => set({ priority: event.target.value })}><option value="">A1 and A2</option><option value="A1">A1 · first wave</option><option value="A2">A2 · second wave</option></select></label>
      <label><span>Industry</span><select value={filters.industry} onChange={(event) => set({ industry: event.target.value })}><option value="">All industries</option>{facets.industry.map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}</select></label>
      <label><span>Stage</span><select value={filters.stage} onChange={(event) => set({ stage: event.target.value })}><option value="">Any stage</option>{OUTREACH_STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Owner</span><select value={filters.owner} onChange={(event) => set({ owner: event.target.value })}><option value="">Anyone</option><option value="none">Unassigned</option>{owners.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>Evidence</span><select value={filters.data} onChange={(event) => set({ data: event.target.value })}><option value="">Any</option>{Object.entries(DATA_FILTERS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      <label><span>Sort</span><select value={filters.sort} onChange={(event) => set({ sort: event.target.value })}>{Object.entries(SORTS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      <button className="btn" type="button" onClick={exportCsv} title="Download the companies shown, with everything on file, as a spreadsheet">Export {filtered.length.toLocaleString()} to CSV</button>
    </div>

    <section className="target-results">
      <header>
        <div>
          <span className="eyebrow">Reach-out companies{active.length ? ` · ${active.map(([key, value]) => key === "data" ? DATA_FILTERS[value]?.label ?? value : key === "owner" && value === "none" ? "Unassigned" : key === "stage" ? STAGE_LABEL[value as OutreachStage] ?? value : key === "sort" ? SORTS[value]?.label ?? value : value).join(" · ")}` : ""}</span>
          <h2>{filtered.length.toLocaleString()} {filtered.length === 1 ? "company" : "companies"}</h2>
        </div>
        <div className="outreach-results-actions">
          {active.length > 0 && <button type="button" className="outreach-clear" onClick={() => setFilters({ q: "", priority: "", industry: "", ownership: "", state: "", stage: "", owner: "", data: "", sort: "intel" })}>Clear filters</button>}
          <span>PAGE {current} / {totalPages}</span>
        </div>
      </header>
      <div className="target-table-wrap">
        <table className="target-directory-table outreach-table">
          <thead><tr><th>Company</th><th>Profile</th><th>Intelligence</th><th>Dossiers</th><th>Stage</th><th>Owner</th><th>Notes</th></tr></thead>
          <tbody>
            {visible.map((row) => <RowView key={row.domain} row={row} busy={busy === row.id} now={now} owners={owners} notesOpen={notesOpen === row.domain} onNotes={() => setNotesOpen(notesOpen === row.domain ? null : row.domain)} onStage={(stage) => patch(row, { outreach_stage: stage })} onOwner={(value) => chooseOwner(row, value)} onSaveNotes={(notes) => patch(row, { outreach_notes: notes })} />)}
            {visible.length === 0 && <tr><td colSpan={7} className="outreach-empty">Nothing matches. Clear a filter or widen the search.</td></tr>}
          </tbody>
        </table>
      </div>
      <nav className="target-pagination" aria-label="Reach-out pages">
        {current > 1 ? <button type="button" className="outreach-page" onClick={() => setPage(current - 1)}>← Previous</button> : <span />}
        <span>{filtered.length ? ((current - 1) * PAGE_SIZE + 1).toLocaleString() : 0}–{Math.min(current * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span>
        {current < totalPages ? <button type="button" className="outreach-page" onClick={() => setPage(current + 1)}>Next →</button> : <span />}
      </nav>
    </section>

    <section className="outreach-hold">
      <header>
        <div><span className="eyebrow">Promotion candidates</span><h2>Hold-list companies with something on file</h2><p>Tiers B and C are watched by the sweep but never contacted. When one shows a real reason to talk, put it on the list here; it keeps its tier and shows as added by hand.</p></div>
        <button type="button" className="btn" onClick={() => setShowHold(!showHold)}>{showHold ? "Hide" : `Show ${holdCandidates.length}`}</button>
      </header>
      {showHold && (holdCandidates.length ? <div className="target-table-wrap"><table className="target-directory-table outreach-table outreach-hold-table">
        <thead><tr><th>Company</th><th>Tier</th><th>Intelligence</th><th>What is on file</th><th></th></tr></thead>
        <tbody>{holdCandidates.map((row) => <tr key={row.domain}>
          <td><Link href={`/accounts/${row.domain}`}><strong>{row.name}</strong></Link><a href={`https://${row.domain}`} target="_blank" rel="noreferrer">{row.domain} ↗</a><small>{row.industry}{row.hqState ? ` · ${row.hqCity}, ${row.hqState}` : ""}</small></td>
          <td><span className={`tier-chip tier-${row.tier}`}>{row.tier}</span></td>
          <td className="intel-cell"><strong className={`intel-score ${row.intelScore >= 60 ? "is-hot" : row.intelScore >= 30 ? "is-warm" : ""}`}>{row.intelScore}</strong></td>
          <td><span>{[row.openRoles ? `${row.openRoles} target roles` : null, row.aiPosts ? `${row.aiPosts} AI posts` : null, row.contacts ? `${row.contacts} contacts` : null].filter(Boolean).join(" · ") || "—"}</span>{row.lastChangeAt && <small>changed {shortDate(row.lastChangeAt)}</small>}</td>
          <td><button type="button" className="btn primary" disabled={busy === row.id} onClick={() => promote(row)}>Put on the list</button></td>
        </tr>)}</tbody>
      </table></div> : <p className="coverage-note">No hold-list company has anything on file yet. Run the hold-list sweep from the Runs page to look.</p>)}
    </section>
  </>;
}

function Facet({ title, items, selected, total, onPick }: { title: string; items: Array<readonly [string, string, number]>; selected: string; total: number; onPick: (value: string) => void }) {
  return <div className="outreach-facet">
    <h3>{title}</h3>
    {items.map(([value, label, count]) => (
      <button type="button" key={value} className={selected === value ? "is-active" : ""} onClick={() => onPick(value)}>
        <span>{label}</span>
        <i><b style={{ width: `${total ? Math.max(2, Math.round((count / total) * 100)) : 0}%` }} /></i>
        <strong>{count}</strong>
      </button>
    ))}
  </div>;
}

function RowView({ row, busy, now, owners, notesOpen, onNotes, onStage, onOwner, onSaveNotes }: { row: OutreachRow; busy: boolean; now: number; owners: string[]; notesOpen: boolean; onNotes: () => void; onStage: (stage: string) => void; onOwner: (value: string) => void; onSaveNotes: (notes: string) => void }) {
  const [draft, setDraft] = useState(row.ownerNotes);
  const changedRecently = row.lastChangeAt && now - Date.parse(row.lastChangeAt) <= WEEK_MS;
  return <>
    <tr className={`${CLOSED_STAGES.has(row.stage) ? "is-closed" : ""} ${!row.synced ? "is-unsynced" : ""}`}>
      <td>
        <Link href={`/accounts/${row.domain}`} className="outreach-name"><strong>{row.name}</strong></Link>
        <a href={`https://${row.domain}`} target="_blank" rel="noreferrer">{row.domain} ↗</a>
        <small>{row.hqCity}{row.hqCity && row.hqState ? ", " : ""}{row.hqState}</small>
        <span className="outreach-chips"><span className={`tier-chip tier-${row.tier}`}>{row.tier}</span>{row.manual && <span className="tier-chip tier-manual">by hand</span>}{!row.synced && <span className="tier-chip tier-unsynced">not synced</span>}</span>
      </td>
      <td>
        <span>{row.industry}</span>
        <small>{row.subSegment}</small>
        <em>{row.ownership}{row.peSponsor ? ` · ${row.peSponsor}` : ""}{row.revenueBand ? ` · $${row.revenueBand}` : ""}</em>
        {row.aiSignal && <small className="outreach-signal">{row.aiSignal}</small>}
      </td>
      <td className="intel-cell">
        <strong className={`intel-score ${row.intelScore >= 60 ? "is-hot" : row.intelScore >= 30 ? "is-warm" : ""}`}>{row.intelScore}</strong>
        <small>{[row.openRoles ? `${row.openRoles} roles` : null, row.aiPosts ? `${row.aiPosts} posts` : null, row.contacts ? `${row.contacts} contacts${row.verifiedEmails ? ` (${row.verifiedEmails} verified)` : ""}` : null].filter(Boolean).join(" · ") || (row.careersStatus ? "nothing found yet" : "not swept yet")}</small>
        <small>{changedRecently ? <b className="outreach-changed">changed {shortDate(row.lastChangeAt)}</b> : row.lastChangeAt ? `changed ${shortDate(row.lastChangeAt)}` : row.lastResearchedAt ? `researched ${shortDate(row.lastResearchedAt)}` : ""}</small>
      </td>
      <td>
        <span>{row.openDossiers ? <Link href={`/desk?q=${encodeURIComponent(row.domain)}`}>{row.openDossiers} ready · top {row.topDossierScore}</Link> : "—"}</span>
        <small>{[row.sent ? `${row.sent} sent` : null, row.replied ? `${row.replied} replied` : null, row.meetings ? `${row.meetings} meetings` : null].filter(Boolean).join(" · ")}</small>
      </td>
      <td>
        <select className={`outreach-stage stage-${row.stage}`} value={row.stage} disabled={busy || !row.synced} onChange={(event) => onStage(event.target.value)}>
          {OUTREACH_STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {row.stageUpdatedAt && <small>{shortDate(row.stageUpdatedAt)}</small>}
      </td>
      <td>
        <select className="outreach-owner" value={row.owner} disabled={busy || !row.synced} onChange={(event) => onOwner(event.target.value)}>
          <option value="">Unassigned</option>
          {owners.map((name) => <option key={name} value={name}>{name}</option>)}
          <option value="__new">Add a name…</option>
        </select>
      </td>
      <td>
        <button type="button" className="outreach-notes-toggle" onClick={onNotes} disabled={!row.synced}>{row.ownerNotes ? row.ownerNotes.slice(0, 80) + (row.ownerNotes.length > 80 ? "…" : "") : "Add a note"}</button>
        <Link href={`/accounts/${row.domain}`} className="outreach-open">Open →</Link>
      </td>
    </tr>
    {notesOpen && <tr className="outreach-notes-row"><td colSpan={7}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} placeholder={`Notes on ${row.name}: who you spoke to, what they said, what to do next`} />
      <div><button type="button" className="btn primary" disabled={busy} onClick={() => onSaveNotes(draft)}>Save note</button><button type="button" className="btn" onClick={onNotes}>Close</button></div>
    </td></tr>}
  </>;
}
