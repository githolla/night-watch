"use client";

import { useState, type ReactNode } from "react";

export type SettingsTab = {
  id: string;
  label: string;
  /** A small icon for the compact nav. */
  icon?: ReactNode;
  /** What to do here, shown above the panel. */
  blurb: string;
  /** Whether this section still needs attention, shown as a chip in the sidebar. */
  status?: { tone: "ok" | "todo" | "info"; label: string };
  content: ReactNode;
};

/**
 * Compact navigation: an icon, a short label, and a status indicator only where one carries information.
 * The long per-section descriptions that used to sit here made the sidebar the loudest thing on the page;
 * counts and explanation now live inside the page they describe, which is where you are when you need
 * them. Only the open panel is rendered.
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
              <span className="settings-navitem-icon" aria-hidden>{tab.icon}</span>
              <strong>{tab.label}</strong>
              {tab.status && <em className={`settings-chip is-${tab.status.tone}`}>{tab.status.label}</em>}
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
