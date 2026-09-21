import type { ReactNode } from "react";

/**
 * Explanation, folded away. The controls are the point of the page, so the long-form "what this does /
 * when to use it" now sits behind a "How this works" disclosure instead of pushing the buttons below the
 * fold. It stays available for someone meeting a screen for the first time, and out of the way afterwards.
 *
 * `watch` is deliberately NOT inside the fold: a consequence you cannot undo, or something that costs
 * money, has to be visible next to the control it applies to, not one click away.
 */
export function PanelGuide({ what, when, watch }: {
  /** One sentence: what pressing the thing actually does. */
  what: ReactNode;
  /** When a person would want it — the situation, not the mechanism. */
  when: ReactNode;
  /** The cost, the catch, or what can't be undone. Always visible. */
  watch?: ReactNode;
}) {
  return (
    <>
      <details className="how-works">
        <summary>How this works</summary>
        <div className="how-works-body">
          <p>{what}</p>
          <p><strong>When to use it.</strong> {when}</p>
        </div>
      </details>
      {watch && <p className="panel-watch">{watch}</p>}
    </>
  );
}
