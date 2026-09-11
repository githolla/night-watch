/**
 * Which companies a run may touch. Outreach is Tier A, the reach-out list;
 * hold is everything active that is not on it (Tiers B and C), which the
 * sweep watches for a signal worth promoting; all is both, reach-out first.
 */
export type RunScope = "outreach" | "hold" | "all";

export const SCOPE_LABEL: Record<RunScope, string> = {
  outreach: "Reach-out list (Tier A)",
  hold: "Hold list (Tiers B and C)",
  all: "Every active company",
};

export function parseScope(value: unknown): RunScope | undefined {
  return value === "outreach" || value === "hold" || value === "all" ? value : undefined;
}

/** The equality an accounts query adds for the scope; nothing for all. */
export function scopeCondition(scope: RunScope): { column: "outreach"; value: boolean } | null {
  if (scope === "outreach") return { column: "outreach", value: true };
  if (scope === "hold") return { column: "outreach", value: false };
  return null;
}
