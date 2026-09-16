"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";

const CATEGORIES = [
  { value: "bug", label: "Something's broken" },
  { value: "confusing", label: "Confusing / unclear" },
  { value: "idea", label: "Idea / request" },
  { value: "praise", label: "This works well" },
  { value: "other", label: "Other" },
] as const;

/** A floating "Feedback" button on every page. Captures the page, the signed-in user (server-side) and a
 *  timestamp automatically, so testers only type what they noticed. */
export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("bug");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setState("saving"); setError("");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: pathname, category, message }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) { setState("error"); setError(json.error ?? "Could not send."); return; }
      setState("done");
      setMessage("");
      setTimeout(() => { setOpen(false); setState("idle"); }, 1400);
    } catch { setState("error"); setError("Could not send."); }
  }

  return (
    <>
      <button type="button" className="fb-fab" onClick={() => setOpen((v) => !v)} aria-label="Give feedback" title="Give feedback">
        <MessageSquarePlus size={18} strokeWidth={1.9} /><span>Feedback</span>
      </button>
      {open && (
        <div className="fb-panel" role="dialog" aria-label="Feedback">
          <div className="fb-panel-head"><strong>Share feedback</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button></div>
          <p className="fb-panel-sub">On <code>{pathname || "/"}</code> — we log who and when automatically.</p>
          {state === "done" ? (
            <p className="fb-thanks">Thanks — logged. 🙏</p>
          ) : (
            <form onSubmit={submit}>
              <div className="fb-cats">
                {CATEGORIES.map((c) => (
                  <button type="button" key={c.value} className={`fb-cat ${category === c.value ? "is-on" : ""}`} onClick={() => setCategory(c.value)}>{c.label}</button>
                ))}
              </div>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} autoFocus placeholder="What happened, what you expected, or what would make it better…" maxLength={4000} />
              <div className="fb-actions">
                <button type="submit" className="btn primary" disabled={state === "saving" || !message.trim()}>{state === "saving" ? "Sending…" : "Send feedback"}</button>
                {state === "error" && <span className="fb-err">{error}</span>}
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
