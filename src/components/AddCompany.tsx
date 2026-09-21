"use client";

import { useEffect, useState } from "react";

type Found = { id: string; name: string; domain: string; vertical: string | null; tier: string | null; outreach: boolean | null; status: string | null };

const TIERS: Array<{ value: "A1" | "A2" | "B" | "C"; label: string }> = [
  { value: "A1", label: "A1 · Reach out first" },
  { value: "A2", label: "A2 · Second wave" },
  { value: "B", label: "B · Hold, watch for a signal" },
  { value: "C", label: "C · Stretch" },
];

// Admin: add a company to the reach-out list by hand. It's persisted as an active, hand-managed account so
// the nightly file sync leaves it alone; the next research run picks it up like any other target.
export function AddCompany() {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [vertical, setVertical] = useState("");
  const [tier, setTier] = useState<"A1" | "A2" | "B" | "C">("A1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);

  // Type-ahead over the company list, so removing one means finding it by name, not recalling its domain.
  useEffect(() => {
    const term = search.trim();
    let live = true;
    // Everything runs in the debounce callback, so no state is set synchronously while the effect runs.
    const timer = setTimeout(() => {
      if (!live) return;
      if (term.length < 2) { setResults([]); setSearching(false); return; }
      setSearching(true);
      fetch(`/api/admin/companies/search?q=${encodeURIComponent(term)}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : { companies: [] }))
        .then((json) => { if (live) setResults(json.companies ?? []); })
        .catch(() => { if (live) setResults([]); })
        .finally(() => { if (live) setSearching(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [search]);

  // Take a company off the reach-out list for good — e.g. an AI-native product company, where the
  // "build this instead of hiring" pitch doesn't land.
  async function remove(company: Found) {
    if (busy) return;
    if (!confirm(`Remove ${company.name} (${company.domain}) from the reach-out list?\n\nIts un-sent drafts are dismissed and the nightly sync won't put it back. Sent history is kept.`)) return;
    setBusy(true); setMsg("Removing…");
    try {
      const res = await fetch("/api/admin/remove-company", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: company.id }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error ?? "Could not remove the company."); return; }
      setMsg(`Removed ${json.name ?? company.name} from the list${json.dismissed ? ` and cleared ${json.dismissed} un-sent draft${json.dismissed === 1 ? "" : "s"}` : ""}.`);
      setResults((current) => current.filter((row) => row.id !== company.id));
    } catch { setMsg("Could not remove the company — try again."); }
    finally { setBusy(false); }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || !domain.trim()) { setMsg("Enter a company name and its website domain."); return; }
    setBusy(true); setMsg("Adding…");
    try {
      const res = await fetch("/api/admin/add-company", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, domain, vertical, tier }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error ?? "Could not add the company."); return; }
      setMsg(`Added ${json.account?.name ?? name} (${json.account?.domain ?? domain}). It'll be researched on the next scan${json.account?.outreach ? " and drafted for outreach" : " (held until it earns a signal)"}.`);
      setName(""); setDomain(""); setVertical("");
    } catch { setMsg("Could not add the company — try again."); }
    finally { setBusy(false); }
  }

  return (
    <section className="conn-card">
      <div className="conn-head"><h2>Companies on the list</h2></div>
      <p className="conn-note">Put a company on the reach-out list by hand. It joins the target list as an active, hand-managed account — the nightly file sync won&apos;t remove it — and the next research run works it like any other target.</p>
      <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name (e.g. Shaw Flooring)" style={{ flex: "1 1 240px", minWidth: 0, border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", background: "var(--paper-bright)", padding: "9px 11px", font: "500 14px/1 var(--sans)", color: "inherit" }} />
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Website domain (e.g. shawinc.com)" style={{ flex: "1 1 220px", minWidth: 0, border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", background: "var(--paper-bright)", padding: "9px 11px", font: "500 14px/1 var(--sans)", color: "inherit" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={vertical} onChange={(e) => setVertical(e.target.value)} placeholder="Industry (optional)" style={{ flex: "1 1 240px", minWidth: 0, border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", background: "var(--paper-bright)", padding: "9px 11px", font: "500 14px/1 var(--sans)", color: "inherit" }} />
          <select value={tier} onChange={(e) => setTier(e.target.value as "A1" | "A2" | "B" | "C")} style={{ flex: "0 1 220px", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", background: "var(--paper-bright)", padding: "9px 11px", font: "500 14px/1 var(--sans)", color: "inherit" }}>
            {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add to list"}</button>
        </div>
      </form>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <p className="conn-note">Remove a company from the reach-out list — search by name, then remove the right one. Use this for AI-native product companies, where the &ldquo;build this instead of hiring&rdquo; pitch doesn&apos;t fit. Un-sent drafts are dismissed, sent history is kept, and the nightly sync won&apos;t put it back.</p>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies by name or domain (e.g. Motive)" style={{ width: "100%", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", background: "var(--paper-bright)", padding: "9px 11px", font: "500 14px/1 var(--sans)", color: "inherit" }} />
        {search.trim().length >= 2 && (
          <div style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", maxHeight: 260, overflowY: "auto" }}>
            {searching && !results.length && <p className="conn-note" style={{ margin: 0, padding: "10px 12px" }}>Searching…</p>}
            {!searching && !results.length && <p className="conn-note" style={{ margin: 0, padding: "10px 12px" }}>No company matches “{search.trim()}”.</p>}
            {results.map((company) => (
              <div key={company.id} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderTop: "1px solid var(--line)" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{company.name}</strong>
                  <small className="conn-note">{company.domain}{company.vertical ? ` · ${company.vertical}` : ""}{company.outreach ? "" : " · already off the list"}</small>
                </div>
                <button type="button" className="btn ghost danger" disabled={busy || !company.outreach} onClick={() => remove(company)}>{company.outreach ? "Remove" : "Removed"}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {msg && <p className="notice" role="status" style={{ marginTop: 12 }}>{msg}</p>}
    </section>
  );
}
