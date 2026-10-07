import assert from "node:assert/strict";
import test from "node:test";
import { needsSync, outreachOnFile, syncTargetAccounts, untieredOnFile } from "./sync-targets.ts";
import { queryDb } from "./testing/query-db.ts";
import { targetAccounts } from "./target-accounts.ts";

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

test("companies outside the target file never count as needing a sync", () => {
  // Curated list and hand-added companies have no tier in the file, and the sync cannot give them one.
  assert.equal(untieredOnFile(["globalpartsllc.com", "dodsonbros.com", "someone-added.test"]), 0);
  assert.equal(untieredOnFile([targetAccounts[0].domain, "globalpartsllc.com"]), 1);
  assert.equal(untieredOnFile([targetAccounts[0].domain.toUpperCase()]), 1);
});

test("the sync never pauses a company on someone's reach-out list or takes it off outreach", async () => {
  // Her First 25 and nightly-list companies are not in the target file. The sync used to pause them and set
  // outreach=false, the worklist refresh then archived their drafts, and she could neither save nor send.
  const { db, tables } = queryDb({
    accounts: [
      { id: "a1", domain: "listedco.test", name: "Listed Co", status: "active", outreach: true, outreach_manual: null, tier: null },
      { id: "a2", domain: "goneco.test", name: "Gone Co", status: "active", outreach: true, outreach_manual: null, tier: null },
    ],
    signals: [{ id: "s1", hash: "operator-shortlist-20260923:listedco.test" }],
  });
  await syncTargetAccounts(db);
  const listed = tables.accounts.find((row) => row.domain === "listedco.test")!;
  const gone = tables.accounts.find((row) => row.domain === "goneco.test")!;
  assert.equal(listed.status, "active", "a listed company stays active");
  assert.equal(listed.outreach, true, "a listed company stays on outreach");
  assert.equal(gone.status, "paused", "a company neither on the file nor on a list is still paused");
});
