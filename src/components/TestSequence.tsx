"use client";

import { useState } from "react";
import Link from "next/link";
import { PanelGuide } from "./PanelGuide";

/**
 * Check the first email and all three follow-ups end to end, against your own inbox.
 *
 * The alternative was repointing a real contact's address in SQL, editing scheduled_at by hand, and
 * calling the cron with its secret — three chances to leave a live prospect mis-addressed.
 */
export function TestSequence({ senderEmail }: { senderEmail: string | null }) {
  const [busy, setBusy] = useState<"" | "create" | "clean">("");
  const [msg, setMsg] = useState("");
  const [cardId, setCardId] = useState<string | null>(null);
  const [to, setTo] = useState("");

  async function create() {
    if (busy) return;
    setBusy("create"); setMsg("");
    try {
      const response = await fetch("/api/admin/test-sequence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: to.trim() || undefined }) });
      const json = await response.json();
      if (!response.ok) { setMsg(json.error ?? "Could not set up the test."); return; }
      setCardId(json.cardId);
      setMsg(`Ready — a test prospect addressed to ${json.to} is on the Worklist.`);
    } catch { setMsg("Could not set up the test."); }
    finally { setBusy(""); }
  }

  async function clean() {
    if (busy) return;
    if (!confirm("Remove the test prospect and everything sent to it? Real prospects are untouched.")) return;
    setBusy("clean"); setMsg("");
    try {
      const response = await fetch("/api/admin/test-sequence", { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) { setMsg(json.error ?? "Could not clean up."); return; }
      setCardId(null);
      setMsg("Removed. Nothing about it is left on the desk or in History.");
    } catch { setMsg("Could not clean up."); }
    finally { setBusy(""); }
  }

  return (
    <section className="conn-card">
      <div className="conn-head"><h2>Test the email and its follow-ups</h2></div>
      <PanelGuide
        what={<>Builds a throwaway prospect addressed to your own inbox, so you can send the first email and all three follow-ups for real and read exactly what a prospect would get.</>}
        when={<>Before handing the app to someone else, and after changing the signature, the sender name or the follow-up wording.</>}
        watch={<>It sends real email from your connected mailbox, so it counts toward the daily cap. The test company is marked so no research run ever touches it, and <strong>Remove the test</strong> deletes it along with everything sent to it.</>}
      />
      <label className="sender-profile-full">
        <span>Send the test to (leave blank to use your connected mailbox{senderEmail ? `, ${senderEmail}` : ""})</span>
        <input value={to} onChange={(event) => setTo(event.target.value)} placeholder={senderEmail ?? "you@nine-67.com"} />
      </label>
      <ol className="test-steps">
        <li>Press <strong>Set up the test</strong> below.</li>
        <li>Open the <strong>Worklist</strong>, find <em>Test Recipient</em> at &ldquo;Sequence test&rdquo;, and press <strong>Send email</strong>. Check your inbox.</li>
        <li>The three follow-ups appear under that draft. Press <strong>Send now</strong> on each to fire it immediately rather than waiting 3, 7 and 14 days. They thread under the first email.</li>
        <li>Reply from your own inbox: within about 15 minutes the sequence should stop itself and the remaining steps should read <em>skipped</em>.</li>
        <li>Press <strong>Remove the test</strong>.</li>
      </ol>
      <div className="draft-tool-actions">
        <button type="button" className="btn primary" disabled={!!busy} onClick={create}>{busy === "create" ? "Setting up…" : "Set up the test"}</button>
        {cardId && <Link className="btn" href={`/desk?card=${cardId}`}>Open it on the Worklist</Link>}
        <button type="button" className="btn ghost danger" disabled={!!busy} onClick={clean}>{busy === "clean" ? "Removing…" : "Remove the test"}</button>
      </div>
      {msg && <p className="notice" role="status" style={{ marginTop: 10 }}>{msg}</p>}
    </section>
  );
}
