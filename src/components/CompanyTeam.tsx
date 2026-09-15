"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TeamPerson = { id: string; full_name: string; title: string; level: string; email: string | null; email_status: string; linkedin_url: string | null };
type Team = {
  account: { name: string; domain: string; vertical: string | null; employees: string | null; tier: string | null; revenueBand: string | null; careersUrl: string | null } | null;
  people: TeamPerson[];
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "•";
}
function linkedinSearch(name: string, company: string) {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${company}`)}`;
}

/** Company details and everyone on file there, loaded on demand for the one-screen prospect flow. */
export function CompanyTeam({ domain, company, activeId, onSelect, compact }: { domain: string; company: string; activeId?: string; onSelect?: (person: TeamPerson) => void; compact?: boolean }) {
  const [team, setTeam] = useState<{ domain: string; data: Team } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/company-team?domain=${encodeURIComponent(domain)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (live && data) setTeam({ domain, data: data as Team }); })
      .catch(() => {});
    return () => { live = false; };
  }, [domain]);

  const ready = team?.domain === domain;
  const account = ready ? team!.data.account : null;
  const people = ready ? team!.data.people : [];
  const facts = [account?.vertical, account?.revenueBand, account?.employees, account?.tier].filter(Boolean) as string[];
  const shown = open ? people : people.slice(0, 6);

  return <div className={`focus-block focus-team ${compact ? "is-compact" : ""}`}>
    {!compact && <>
      <div className="focus-team-head">
        <span className="focus-why-label">The company</span>
        {account?.careersUrl && <a href={account.careersUrl} target="_blank" rel="noreferrer" className="focus-link">Careers page &#8599;</a>}
      </div>
      {facts.length > 0 && <p className="focus-team-facts">{facts.join(" · ")}</p>}
      <Link href={`/accounts/${domain}`} className="focus-link">Everything on {company} &rarr;</Link>
    </>}

    <div className="focus-team-people">
      <span className="focus-why-label">{compact ? "People to contact" : `Everyone on file${people.length ? ` · ${people.length}` : ""}`}{compact && people.length ? <em className="focus-team-count">{people.length} available</em> : null}</span>
      {!ready && <p className="focus-team-loading">Loading the team…</p>}
      {ready && people.length === 0 && <p className="focus-team-loading">No one on file yet for this company.</p>}
      {shown.map((person) => (
        <div key={person.id} className={`focus-team-row ${onSelect ? "is-selectable" : ""} ${activeId === person.id ? "is-active" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined}
          onClick={onSelect ? () => onSelect(person) : undefined}
          onKeyDown={onSelect ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(person); } } : undefined}>
          <span className="avatar">{initials(person.full_name)}</span>
          <div className="focus-team-id"><strong>{person.full_name}{activeId === person.id ? <em className="focus-team-flag">writing to</em> : null}</strong><small>{person.title || "title unknown"}</small></div>
          <div className="focus-team-contact">
            {person.email ? <span title={person.email_status}>{person.email}</span> : null}
            {person.linkedin_url
              ? <a href={person.linkedin_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>LinkedIn &#8599;</a>
              : <a href={linkedinSearch(person.full_name, company)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Find &#8599;</a>}
          </div>
        </div>
      ))}
      {people.length > 6 && <button type="button" className="focus-team-more" onClick={() => setOpen((value) => !value)}>{open ? "Show fewer" : `Show all ${people.length}`}</button>}
    </div>
  </div>;
}
