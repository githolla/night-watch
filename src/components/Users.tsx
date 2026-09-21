"use client";

import { useEffect, useState } from "react";
import { PanelGuide } from "./PanelGuide";

type Row = { id: string; email: string; name: string; owner: string; role: string; last_login_at: string | null };

/** Admin-only: add teammates with their own email + password sign-on, set their sending seat and role. */
export function Users() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", email: "", owner: "josh", role: "member", password: "" });
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setRows(json.users ?? []);
  }
  useEffect(() => {
    let live = true;
    fetch("/api/admin/users", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (live) { setRows(json?.users ?? []); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const payload = { ...form, password: form.password.trim() ? form.password : undefined };
      const res = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) { setMessage(json.error ?? "Could not add the user."); return; }
      setForm({ name: "", email: "", owner: "josh", role: "member", password: "" });
      if (json.inviteUrl) {
        try { await navigator.clipboard.writeText(json.inviteUrl); } catch { /* ignore */ }
        setMessage(`Invite created and copied to your clipboard — send it to them: ${json.inviteUrl}`);
      } else {
        setMessage("Added with a temp password — share it so they can sign in.");
      }
      await load();
    } finally { setBusy(false); }
  }
  async function resetPassword(row: Row) {
    const password = prompt(`New password for ${row.name} (min 8 characters):`);
    if (!password) return;
    const res = await fetch(`/api/admin/users/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    setMessage(res.ok ? `Password reset for ${row.name}.` : "Could not reset the password (min 8 characters).");
  }
  async function emailInvite(row: Row) {
    setSending(row.id); setMessage("");
    try {
      const res = await fetch(`/api/admin/users/${row.id}/invite-email`, { method: "POST" });
      const json = await res.json();
      setMessage(res.ok ? `Invite emailed to ${row.email} — sent from ${json.sentFrom}.` : (json.error ?? "Could not send the invite email."));
    } finally { setSending(null); }
  }
  async function changeSeat(row: Row, owner: string) {
    if (owner === row.owner) return;
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, owner } : item)));
    const res = await fetch(`/api/admin/users/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner }) });
    if (res.ok) { setMessage(`${row.name} moved to ${owner === "jenna" ? "Seat 2" : "Seat 1"}. They connect their own Google on that seat.`); await load(); }
    else { setMessage("Could not change the seat."); await load(); }
  }
  async function remove(row: Row) {
    if (!confirm(`Remove ${row.name}? They will lose access immediately.`)) return;
    const res = await fetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { setMessage(json.error ?? "Could not remove the user."); return; }
    await load();
  }

  return (
    <section className="conn-card">
      <PanelGuide
        what="Creates a sign-in for someone else on the team, and assigns them a sending seat."
        when={<>Someone new needs to work the desk. Give them their own sign-on rather than sharing yours, so History records who actually sent what.</>}
        watch={<>Their <strong>seat</strong> decides which connected mailbox their emails leave from &mdash; so after you invite them, they need to connect their own Google account under <strong>Sending &amp; identity</strong>, or their sends will have nowhere to go.</>}
      />
      <header className="conn-head"><div><h2>Team members</h2><p>Each teammate signs in with their own email and password. Their <strong>seat</strong> decides which connected Google account their outreach sends from.</p></div></header>

      <form className="users-form" onSubmit={addUser}>
        <div className="users-form-row">
          <label><span>Name</span><input placeholder="Josh Lee" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="grow"><span>Email</span><input type="email" placeholder="josh@nine-67.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        </div>
        <div className="users-form-row">
          <label><span>Seat</span><select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}><option value="josh">Seat 1</option><option value="jenna">Seat 2</option></select></label>
          <label><span>Role</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <label className="grow"><span>Password <em>optional</em></span><input type="text" placeholder="Leave blank to send an invite link" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        </div>
        <button className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add teammate"}</button>
      </form>
      <p className="conn-note">Leave the password blank to generate an <strong>invite link</strong> (copied to your clipboard). Then hit <strong>Email invite</strong> on their row to send it straight from a connected Google seat — or paste the link into your own email. They set their password from the link, then connect their Google account.</p>
      {message && <p className="notice" role="status">{message}</p>}

      <div className="users-list">
        {loading && <p className="conn-note">Loading team…</p>}
        {!loading && rows.length === 0 && <p className="conn-note">No sign-ons yet. Add your teammates above — you&rsquo;re currently in as the workspace admin.</p>}
        {rows.map((row) => (
          <div key={row.id} className="conn-row is-on">
            <div className="conn-who"><span className="conn-dot is-on" /><div><strong>{row.name} {row.role === "admin" && <em className="conn-chip is-on">Admin</em>}</strong><small>{row.email}{row.last_login_at ? ` · last in ${new Date(row.last_login_at).toLocaleDateString()}` : " · never signed in"}</small></div></div>
            <div className="conn-actions"><label className="users-seat"><span>Seat</span><select value={row.owner} onChange={(e) => changeSeat(row, e.target.value)}><option value="josh">Seat 1</option><option value="jenna">Seat 2</option></select></label><button type="button" className="btn" disabled={sending === row.id} onClick={() => emailInvite(row)}>{sending === row.id ? "Sending…" : "Email invite"}</button><button type="button" className="btn" onClick={() => resetPassword(row)}>Reset password</button><button type="button" className="btn ghost danger" onClick={() => remove(row)}>Remove</button></div>
          </div>
        ))}
      </div>
    </section>
  );
}
