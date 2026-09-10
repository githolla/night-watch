"use client";

import { useState } from "react";

type Result = {
  accounts: number;
  signals: number;
  cards: number;
  cost: number;
  errors: Array<{ message?: string }>;
  researched: Array<{ name: string; domain: string }>;
};

export function RunNightWatchButton({ disabled = false }: { disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<string[]>([]);

  async function run() {
    setState("running");
    setProgress([]);
    const total = 10;
    const batchBudget = 1;
    const totals = { accounts: 0, signals: 0, cards: 0, errors: 0, cost: 0 };

    for (let index = 0; index < total; index += 1) {
      setMessage(`Researching priority company ${index + 1} of ${total}. Completed evidence is saved after every company.`);
      let response: Response;
      try {
        response = await fetch("/api/nightly/run", { method: "POST" });
      } catch {
        setState("error");
        setMessage(`Connection interrupted after ${totals.accounts} companies. Everything completed so far is saved; press retry to continue with the next target.`);
        return;
      }
      let result: Result & { error?: string };
      try {
        result = await response.json() as Result & { error?: string };
      } catch {
        setState("error");
        setMessage(`The server ended company ${index + 1} before returning a result. ${totals.accounts} completed companies were saved; continue to resume safely.`);
        return;
      }
      if (!response.ok) {
        setState("error");
        setMessage(`${result.error ?? "Research failed"}. ${totals.accounts} completed companies were saved; retry continues with the next eligible target.`);
        return;
      }

      totals.accounts += result.accounts;
      totals.signals += result.signals;
      totals.cards += result.cards;
      totals.errors += result.errors.length;
      totals.cost += result.cost;
      const company = result.researched[0]?.name ?? "No eligible company";
      const providerError = result.errors[0]?.message?.replace(/^Error:\s*/i, "").slice(0, 140);
      const outcome = result.errors.length > 0
        ? `${company} — ${providerError ?? "research error logged"}`
        : result.cards > 0
        ? `${company} — outreach dossier ready`
        : result.signals > 0
          ? `${company} — public evidence saved`
          : `${company} — no attributable source found`;
      setProgress((current) => [...current, outcome]);

      if (totals.cost >= batchBudget) {
        setState("done");
        setMessage(`Cost stop reached after ${totals.accounts} companies. Results are saved. Anthropic cost: $${totals.cost.toFixed(3)}; the batch will not spend further.`);
        window.setTimeout(() => window.location.reload(), 1600);
        return;
      }
      if (result.accounts === 0) break;
    }

    setState("done");
    setMessage(`Complete: ${totals.accounts} companies checked, ${totals.signals} sources saved, ${totals.cards} outreach dossiers created, ${totals.errors} errors. Anthropic cost: $${totals.cost.toFixed(3)}.`);
    window.setTimeout(() => window.location.reload(), 1200);
  }

  return <div className="run-watch-control">
    <button className="btn primary" type="button" disabled={disabled || state === "running"} onClick={run}>
      {state === "running" ? "Research in progress…" : state === "error" ? "Continue research" : "Research next 10 companies"}
    </button>
    {message && <p className={state === "error" ? "notice error" : "notice"} aria-live="polite">{message}</p>}
    {progress.length > 0 && <ol className="run-watch-progress">{progress.map((item, index) => <li key={`${index}-${item}`}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>)}</ol>}
  </div>;
}
