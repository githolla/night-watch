import test from "node:test";
import assert from "node:assert/strict";
import { backfillCallPlans } from "./call-backfill.ts";
import { queryDb } from "./testing/query-db.ts";
const row = { channel: "email", card_id: "card", person_id: "person", sent_by: "josh", sent_at: new Date().toISOString(), people: { do_not_contact: false }, cards: { status: "sent", assigned_to: "josh", accounts: { status: "active" } } };
function harness(cadences: Record<string, unknown>[] = []) {
  const h = queryDb({ touches: [row], cadences });
  return h;
}
test("backfilling creates only a call plan and never automatic follow-up emails", async () => {
  const h = harness();
  assert.equal(await backfillCallPlans(h.db), 1);
  assert.equal(h.tables.cadences[0].status, "completed");
  assert.equal(h.tables.cadence_steps?.length ?? 0, 0);
  assert.equal(await backfillCallPlans(h.db), 0);
});
test("backfilling preserves stopped or existing email sequences", async () => {
  const h = harness([{ id: "existing", card_id: "card", status: "stopped", rules: { stop_on_reply: true } }]);
  assert.equal(await backfillCallPlans(h.db), 0);
  assert.equal(h.tables.cadences[0].status, "stopped");
  assert.deepEqual(h.tables.cadences[0].rules, { stop_on_reply: true });
});
test("backfilling does not create call follow-ups from bounced emails", async () => {
  const h = harness();
  h.tables.touches[0].bounced_at = row.sent_at;
  assert.equal(await backfillCallPlans(h.db), 0);
  assert.equal(h.tables.cadences.length, 0);
});
