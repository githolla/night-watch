import test from "node:test";
import assert from "node:assert/strict";
import { knownTargetSites } from "./watchlist.ts";
import { queryDb } from "../testing/query-db.ts";
test("latest list research supplies company ownership and excluded accounts are not monitored", async () => {
  const { db } = queryDb({ reachout_lists: [
    { status: "ready", list_date: "2026-10-14", owner: "suuchi", rows: [{ domain: "listed-target.test", company: "Latest company name" }, { domain: "blocked-target.test", company: "Blocked" }] },
    { status: "ready", list_date: "2026-10-12", owner: "josh", rows: [{ domain: "listed-target.test", company: "Older company name" }] },
  ], accounts: [{ domain: "blocked-target.test", status: "do_not_contact" }, { domain: "unlisted-account.test", status: "active", name: "Not on our lists" }] });
  const sources = await knownTargetSites(db);
  const target = sources.find(source => source.domain === "listed-target.test");
  assert.equal(target?.company, "Latest company name"); assert.equal(target?.owner, "suuchi");
  assert.equal(sources.some(source => source.domain === "blocked-target.test"), false);
  assert.equal(sources.some(source => source.domain === "unlisted-account.test"), false);
});
