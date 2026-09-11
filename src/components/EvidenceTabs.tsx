"use client";

import { useState, type ReactNode } from "react";

/** One card, several kinds of evidence, one visible at a time. */
export function EvidenceTabs({ tabs }: { tabs: Array<{ id: string; label: string; count: number; content: ReactNode }> }) {
  const [active, setActive] = useState(tabs.find((tab) => tab.count > 0)?.id ?? tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return <section className="card" id="evidence">
    <div className="tabs-row"><nav className="tabs" aria-label="Evidence">{tabs.map((tab) => <button key={tab.id} type="button" className={tab.id === active ? "is-active" : ""} onClick={() => setActive(tab.id)}>{tab.label}<b>{tab.count}</b></button>)}</nav></div>
    <div>{current?.content}</div>
  </section>;
}
