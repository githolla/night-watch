"use client";

import type { ReactNode } from "react";

/** A calm, in-page "are you sure?" in place of a browser pop-up: what will happen, a clear yes and a way back. */
export function InlineConfirm({ title, children, yes, busy = false, onYes, onCancel }: {
  title: string;
  children?: ReactNode;
  yes: string;
  busy?: boolean;
  onYes: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="as-confirm inline-confirm" role="group" aria-label={title}>
      <h3>{title}</h3>
      {children && <div className="inline-confirm-text">{children}</div>}
      <div className="as-controls">
        <button type="button" className="btn primary inline-confirm-yes" disabled={busy} onClick={onYes} autoFocus>{yes}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
