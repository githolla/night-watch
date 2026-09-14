"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { configured: boolean; checked: number; emails: number; linkedins: number; cleared?: number; error?: string };

/** One press asks Apollo for a verified email and LinkedIn URL for the people already on file at this company. */
export function EnrichButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPhase("running");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/accounts/${accountId}/enrich`, { method: "POST" });
      const json = (await response.json().catch(() => ({}))) as Result;
      if (!response.ok) throw new Error(json.error ?? `Request failed (${response.status})`);
      setMessage(`Checked ${json.checked} — ${json.emails} verified ${json.emails === 1 ? "email" : "emails"} and ${json.linkedins} LinkedIn ${json.linkedins === 1 ? "URL" : "URLs"} added${json.cleared ? `, ${json.cleared} guesses cleared` : ""}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enrichment failed");
    } finally {
      setPhase("idle");
    }
  }

  return <div className="enrich-action">
    <button className="btn-secondary" type="button" disabled={phase === "running"} onClick={run}>
      {phase === "running" ? "Asking Apollo…" : "Enrich contacts with Apollo"}
    </button>
    {message && <span className="enrich-note">{message}</span>}
    {error && <span className="enrich-note is-error">{error}</span>}
  </div>;
}
