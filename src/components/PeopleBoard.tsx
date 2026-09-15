"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type PersonRow = {
  id: string;
  name: string;
  title: string;
  company: string;
  domain: string;
  level: string;
  email: string | null;
  emailStatus: string;
  linkedin: string | null;
  source: string | null;
  createdAt: string | null;
  enrichedAt: string | null;
  draftCardId: string | null;
  draftScore: number;
};
export type PeopleFilters = { q: string; level: string; email: string; show: string; sort: string };

const PAGE_SIZE = 60;
const WEEK_MS = 7 * 86_400_000;
const LEVEL_LABEL: Record<string, string> = { owner: "Decision owner", influencer: "Influencer", adjacent: "Adjacent", unknown: "Unknown" };
const EMAIL_LABEL: Record<string, string> = { verified: "Verified", catch_all: "Catch-all", unverified: "Unverified", none: "None" };
const LEVEL_RANK: Record<string, number> = { owner: 3, influencer: 2, adjacent: 1, unknown: 0 };
const reachRank = (row: PersonRow) => (row.emailStatus === "verified" ? 3 : row.email ? 2 : row.linkedin ? 1 : 0);

const TABS: Array<{ value: string; label: string; test: (row: PersonRow, now: number) => boolean }> = [
  { value: "", label: "Everyone", test: () => true },
  { value: "verified", label: "Verified email", test: (row) => row.emailStatus === "verified" },
  { value: "email", label: "Has an email", test: (row) => Boolean(row.email) },
  { value: "linkedin", label: "On LinkedIn", test: (row) => Boolean(row.linkedin) },
  { value: "owner", label: "Decision owners", test: (row) => row.level === "owner" },
  { value: "drafted", label: "Draft ready", test: (row) => Boolean(row.draftCardId) },
  { value: "recent", label: "Added this week", test: (row, now) => Boolean(row.createdAt && now - Date.parse(row.createdAt) <= WEEK_MS) },
];

const SORTS: Record<string, { label: string; compare: (a: PersonRow, b: PersonRow) => number }> = {
  best: { label: "Best contact", compare: (a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || reachRank(b) - reachRank(a) || a.name.localeCompare(b.name) },
  name: { label: "Name A–Z", compare: (a, b) => a.name.localeCompare(b.name) },
  company: { label: "Company A–Z", compare: (a, b) => a.company.localeCompare(b.company) || a.name.localeCompare(b.name) },
  recent: { label: "Recently added", compare: (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") },
};

const emailTone = (row: PersonRow) => (row.emailStatus === "verified" ? "ok" : row.emailStatus === "catch_all" ? "attention" : row.email ? "attention" : "muted");
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "•";
}
function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

/** Instant-search directory of everyone on file: search as you type, filter, sort, copy an email in one click. */
export function PeopleBoard({ rows, initial, verified, withLinkedIn }: { rows: PersonRow[]; initial: PeopleFilters; verified: number; withLinkedIn: number }) {
  const [filters, setFilters] = useState<PeopleFilters>(initial);
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value && !(key === "sort" && value === "best")) query.set(key, value);
    const next = query.toString() ? `/people?${query}` : "/people";
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [filters]);

  const set = (patch: Partial<PeopleFilters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const tab = TABS.find((item) => item.value === filters.show) ?? TABS[0];
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((row) =>
      (!q || [row.name, row.title, row.company, row.email ?? "", row.domain].some((value) => value.toLowerCase().includes(q))) &&
      (!filters.level || row.level === filters.level) &&
      (!filters.email || row.emailStatus === filters.email) &&
      tab.test(row, now)).sort((SORTS[filters.sort] ?? SORTS.best).compare);
  }, [rows, filters, tab, now]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const narrowed = Boolean(filters.q || filters.level || filters.email || filters.show || (filters.sort && filters.sort !== "best"));

  async function copyEmail(email: string) {
    try { await navigator.clipboard.writeText(email); setCopied(email); setTimeout(() => setCopied((value) => (value === email ? null : value)), 1400); } catch { /* selection copy fallback */ }
  }
  function exportCsv() {
    const header = ["name", "title", "company", "website", "level", "email", "email_status", "linkedin", "added"];
    const lines = filtered.map((row) => [row.name, row.title, row.company, row.domain, LEVEL_LABEL[row.level] ?? row.level, row.email ?? "", EMAIL_LABEL[row.emailStatus] ?? row.emailStatus, row.linkedin ?? "", row.createdAt?.slice(0, 10) ?? ""].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `people-${new Date(now).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <>
    <section className="stat-row">
      <button type="button" className={`stat ${filters.show === "verified" ? "is-active" : ""}`} onClick={() => set({ show: filters.show === "verified" ? "" : "verified" })}><span>Verified email</span><strong>{verified.toLocaleString()}</strong><small>ready to email</small></button>
      <button type="button" className={`stat ${filters.show === "linkedin" ? "is-active" : ""}`} onClick={() => set({ show: filters.show === "linkedin" ? "" : "linkedin" })}><span>On LinkedIn</span><strong>{withLinkedIn.toLocaleString()}</strong><small>profile on file</small></button>
      <button type="button" className={`stat ${filters.show === "owner" ? "is-active" : ""}`} onClick={() => set({ show: filters.show === "owner" ? "" : "owner" })}><span>Decision owners</span><strong>{rows.filter((row) => row.level === "owner").length.toLocaleString()}</strong><small>senior enough to buy</small></button>
      <button type="button" className={`stat ${filters.show === "drafted" ? "is-active" : ""}`} onClick={() => set({ show: filters.show === "drafted" ? "" : "drafted" })}><span>Draft ready</span><strong>{rows.filter((row) => row.draftCardId).length.toLocaleString()}</strong><small>outreach written</small></button>
    </section>

    <section className="card">
      <div className="tabs-row">
        <nav className="tabs" aria-label="Show">{TABS.map((item) => <button key={item.value} type="button" className={tab.value === item.value ? "is-active" : ""} onClick={() => set({ show: item.value })}>{item.label}<b>{rows.filter((row) => item.test(row, now)).length}</b></button>)}</nav>
        <div className="toolbar">
          <input value={filters.q} onChange={(event) => set({ q: event.target.value })} placeholder="Search name, title, company or email" aria-label="Search" />
          <select value={filters.level} onChange={(event) => set({ level: event.target.value })} aria-label="Level"><option value="">Any level</option>{Object.entries(LEVEL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={filters.email} onChange={(event) => set({ email: event.target.value })} aria-label="Email state"><option value="">Any email</option>{Object.entries(EMAIL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={filters.sort} onChange={(event) => set({ sort: event.target.value })} aria-label="Sort">{Object.entries(SORTS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>
          <button type="button" className="btn-secondary" onClick={exportCsv}>Export</button>
          {narrowed && <button type="button" className="btn-link" onClick={() => setFilters({ q: "", level: "", email: "", show: "", sort: "best" })}>Clear</button>}
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Level</th><th>Email</th><th /></tr></thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td><div className="cell-lead"><span className="avatar sm">{initials(row.name)}</span><strong>{row.name}</strong>{row.draftCardId && <Link href={`/desk?card=${row.draftCardId}`} className="pill pill-ink people-draft" onClick={(event) => event.stopPropagation()}><i />Draft {row.draftScore || ""}</Link>}</div></td>
                <td className="cell-clamp">{row.title || "—"}</td>
                <td><Link href={`/accounts/${row.domain}`} className="people-company">{row.company}</Link></td>
                <td>{row.level && row.level !== "unknown" ? <span className={`pill pill-${row.level === "owner" ? "accent" : "muted"}`}>{LEVEL_LABEL[row.level] ?? row.level}</span> : <span className="cell-sub">—</span>}</td>
                <td>{row.email
                  ? <button type="button" className={`people-email pill pill-${emailTone(row)}`} title={`${row.email} · click to copy`} onClick={() => copyEmail(row.email!)}>{copied === row.email ? "Copied ✓" : row.email}</button>
                  : <span className="cell-sub">none</span>}</td>
                <td className="people-actions">{row.linkedin ? <a href={row.linkedin} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>LinkedIn ↗</a> : null}</td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={6} className="cell-empty">{narrowed ? "No people match these filters." : "No people yet. The scan finds them on company sites, LinkedIn results and press as it runs."}</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="table-foot">
        <span>{filtered.length ? ((current - 1) * PAGE_SIZE + 1).toLocaleString() : 0}–{Math.min(current * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span>
        <div>{current > 1 && <button type="button" className="btn-secondary" onClick={() => setPage(current - 1)}>Previous</button>}{current < totalPages && <button type="button" className="btn-secondary" onClick={() => setPage(current + 1)}>Next</button>}</div>
      </footer>
    </section>
  </>;
}
