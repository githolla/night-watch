import assert from "node:assert/strict";
import test from "node:test";
import { batchFocus, nextBatchFocus } from "./focus-data.ts";

test("no company is on both Josh's and Suuchi's lists", () => {
  const owners = new Map<string, Set<string>>();
  for (const row of [...batchFocus(), ...nextBatchFocus()]) {
    const domain = row.domain.trim().toLowerCase().replace(/^www\./, "");
    owners.set(domain, (owners.get(domain) ?? new Set()).add(row.assignedOwner === "josh" ? "josh" : "suuchi"));
  }
  assert.ok(owners.size >= 50, `expected the batch lists to load, got ${owners.size} companies`);
  const shared = [...owners].filter(([, seats]) => seats.size > 1).map(([domain]) => domain);
  assert.deepEqual(shared, [], `On both lists: ${shared.join(", ")}`);
});
