"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A tool that belongs to a page but shouldn't take up room on it: the trigger sits in the page header, and
 * the tool itself slides over from the right.
 *
 * Adding a company and fixing drafts are everyday work actions, so they now live on the pages where that
 * work happens rather than in Settings. A drawer keeps them there without pushing the table or the worklist
 * — the reason you came to the page — below the fold.
 */
export function ToolDrawer({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Escape closes it, and the page behind it doesn't scroll while it's over the top.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open]);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="tool-drawer-scrim" role="presentation" onClick={() => setOpen(false)}>
          <aside
            className="tool-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="tool-drawer-head">
              <h2>{title}</h2>
              <button type="button" className="tool-drawer-close" aria-label="Close" onClick={() => setOpen(false)}>&times;</button>
            </header>
            <div className="tool-drawer-body">{children}</div>
          </aside>
        </div>
      )}
    </>
  );
}
