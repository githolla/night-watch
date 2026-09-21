"use client";

import { useState, type ReactNode } from "react";

export type SettingsTab = {
  id: string;
  label: string;
  /** One line in the sidebar: what this section is, in the user's words. */
  summary: string;
  /** What to do here, shown above the panel. */
  blurb: string;
  /** Whether this section still needs attention, shown as a chip in the sidebar. */
  status?: { tone: "ok" | "todo" | "info"; label: string };
  content: ReactNode;
};

/**
 * Settings is six unrelated concerns — sending identity, companies, drafts, team, feedback, system — and a
 * row of bare tab labels gave no clue which one you needed or whether anything was set up. Each section now
 * says what it is and whether it is ready, and the panel opens with what to do, so the page reads as a
 * short list of jobs rather than a wall of controls. Only the open panel is rendered.
 */
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  // Open on the first thing that still needs doing, so a half-configured app points at its own gap.
  const [active, setActive] = useState(() => (tabs.find((tab) => tab.status?.tone === "todo") ?? tabs[0])?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  const todo = tabs.filter((tab) => tab.status?.tone === "todo");

  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-head">
          <h1>Settings</h1>
          <p>{todo.length
            ? `${todo.length} thing${todo.length === 1 ? "" : "s"} still to set up. Start at the top.`
            : "Everything essential is set up. These are the controls behind it."}</p>
        </div>
        <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" className="settings-navlist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={tab.id === current?.id}
              className={`settings-navitem ${tab.id === current?.id ? "is-on" : ""}`}
              onClick={() => setActive(tab.id)}
            >
              <span className="settings-navitem-top">
                <strong>{tab.label}</strong>
                {tab.status && <em className={`settings-chip is-${tab.status.tone}`}>{tab.status.label}</em>}
              </span>
              <small>{tab.summary}</small>
            </button>
          ))}
        </div>
      </nav>

      <section role="tabpanel" aria-label={current?.label} className="settings-panel">
        {current && (
          <header className="settings-panel-head">
            <h2>{current.label}</h2>
            <p>{current.blurb}</p>
          </header>
        )}
        {current?.content}
      </section>
    </div>
  );
}
