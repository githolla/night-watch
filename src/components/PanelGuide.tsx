import type { ReactNode } from "react";

/**
 * The same three questions answered above every tool in Settings: what it does, when you'd reach for it,
 * and the one thing that bites if you don't know it (what it costs, or what it changes that you can't undo).
 *
 * It is the same shape every time on purpose. Each panel used to explain itself in its own voice, at its own
 * length, in prose the user had to read in full to find out whether the button was safe to press — so the
 * page read as a lot of controls with no way in. Answering the same three questions in the same order means
 * you learn the pattern once and can then skim any section.
 */
export function PanelGuide({ what, when, watch }: {
  /** One sentence: what pressing the thing actually does. */
  what: ReactNode;
  /** When a person would want it — the situation, not the mechanism. */
  when: ReactNode;
  /** Optional: the cost, the catch, or what can't be undone. */
  watch?: ReactNode;
}) {
  return (
    <dl className="panel-guide">
      <div><dt>What this does</dt><dd>{what}</dd></div>
      <div><dt>When to use it</dt><dd>{when}</dd></div>
      {watch && <div className="is-watch"><dt>Worth knowing</dt><dd>{watch}</dd></div>}
    </dl>
  );
}
