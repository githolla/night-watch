"use client";

import { useState, type ReactNode } from "react";

export type SettingsTab = { id: string; label: string; content: ReactNode };

/**
 * Settings is a stack of unrelated panels — sending identity, companies, drafts, team, feedback, system.
 * Tabs keep it to one screen instead of one long scroll, and only the active panel is rendered.
 */
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="settings-tabs">
      <div role="tablist" aria-label="Settings sections" className="settings-tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={tab.id === current?.id}
            className={`settings-tab ${tab.id === current?.id ? "is-on" : ""}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="settings-tabpanel">{current?.content}</div>
    </div>
  );
}
