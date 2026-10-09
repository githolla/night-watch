"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Type the right address for a person. It counts as confirmed by you; a bounced person goes back in the queue. */
export function AddressFix({ personId, current, label = "Change address" }: { personId: string; current: string | null; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`/api/people/${personId}/address`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: value }) });
      const json = await response.json().catch(() => ({})) as { email?: string; error?: string };
      if (!response.ok) { setNote({ text: json.error ?? "Not saved. Try again.", ok: false }); return; }
      setOpen(false);
      setNote({ text: `Saved ${json.email}. It counts as confirmed, and a bounced email goes again to this address.`, ok: true });
      router.refresh();
    } catch { setNote({ text: "Not saved: the connection dropped.", ok: false }); }
    finally { setBusy(false); }
  }

  return (
    <span className="address-fix">
      {open
        ? <span className="address-fix-form">
            <input type="email" value={value} aria-label="Correct email address" placeholder="name@company.com" onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} />
            <button type="button" className="btn primary" disabled={busy || !value.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => { setOpen(false); setNote(null); }}>Cancel</button>
          </span>
        : <button type="button" className="btn ghost address-fix-open" onClick={() => { setOpen(true); setNote(null); }}>{label}</button>}
      {note && <small className={`address-fix-note ${note.ok ? "is-ok" : "is-bad"}`} role="status">{note.text}</small>}
    </span>
  );
}
