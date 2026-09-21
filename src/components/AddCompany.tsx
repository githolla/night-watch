"use client";

import { useState } from "react";

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
      <div className="conn-head"><h2>Add a company</h2></div>
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
      {msg && <p className="notice" role="status" style={{ marginTop: 12 }}>{msg}</p>}
    </section>
  );
}
