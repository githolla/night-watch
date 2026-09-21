import assert from "node:assert/strict";
import test from "node:test";
import { needsSync, outreachOnFile } from "./sync-targets.ts";

test("taking a company off the list by hand never forces a permanent re-sync", () => {
  const cut = outreachOnFile;
  assert.ok(cut > 0, "the target file should name some reach-out companies");

  // In step with the file: nothing to do.
  assert.equal(needsSync(cut, 0, 0), false);

  // The regression: removing a company sets outreach=false, which used to drop the count below the file's
  // and made this true forever — so the full 1,859-row sync ran inline on every /outreach and /targets
  // render. A hand-removed company is still accounted for, so nothing needs importing.
  assert.equal(needsSync(cut - 1, 1, 0), false, "one hand-removed company must not trigger a sync");
  assert.equal(needsSync(cut - 25, 25, 0), false, "twenty-five must not either");

  // Hand-ADDED companies push the count above the file's; that is not a reason to re-import either.
  assert.equal(needsSync(cut + 10, 0, 0), false);

  // Still true for the cases it exists for: companies genuinely absent, or rows imported without a tier.
  assert.equal(needsSync(cut - 1, 0, 0), true, "a company missing outright still needs the sync");
  assert.equal(needsSync(0, 0, 0), true, "an empty database still needs the sync");
  assert.equal(needsSync(cut, 0, 3), true, "untiered rows still need the sync");
});
