import type { TargetTier } from "./target-tiers.generated.ts";

/** Kept apart from target-accounts so a client component can show a tier without bundling the whole target list. */
export const TIER_LABEL: Record<TargetTier, string> = {
  A1: "A1 · Reach out first",
  A2: "A2 · Second wave",
  B: "B · Hold, needs a signal",
  C: "C · Stretch ($1-5B)",
  removed: "Removed",
};
