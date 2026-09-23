import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lintEmail } from "../../tools/email-writer/src/lint.ts";
import curatedDrafts from "../../data/priority-outreach.json" with { type: "json" };
import { recipientResearch } from "./recipient-research.ts";

test("all 25 emails pass the supplied writer kit and use its primary buyers", () => {
  const briefs = readFileSync(new URL("../../data/outreach-research/account_briefs.jsonl", import.meta.url), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const dossiers = readFileSync(new URL("../../data/outreach-research/dossiers.jsonl", import.meta.url), "utf8").trim().split("\n").map(line => JSON.parse(line));
  for (const row of curatedDrafts) {
    const brief = briefs.find(item => item.account_id === row.writerKit.accountId);
    assert.ok(brief, row.company);
    const buyer = brief.contacts.find((person: { contact_rank: number }) => person.contact_rank === 1);
    assert.equal(row.buyer.name, `${buyer.first_name} ${buyer.last_name}`);
    const result = lintEmail({ touch: 1, subject: row.subject, body: row.message });
    assert.equal(result.pass, true, `${row.company}: ${JSON.stringify(result.issues)}`);
    assert.ok(row.writerKit.factIds.length, row.company);
    const dossier = dossiers.find(item => item.account_id === row.writerKit.accountId);
    for (const fact of row.writerKit.facts) {
      const source = dossier.facts.find((item: { fact_id: string }) => item.fact_id === fact.fact_id);
      assert.deepEqual(fact, source, `${row.company}: source fact was changed`);
    }
  }
});

test("revised buyer research does not match superseded contacts", () => {
  assert.ok(recipientResearch("shure.com", "Jerome Nolasco"));
  assert.equal(recipientResearch("shure.com", "Monique Rezaei"), undefined);
  assert.ok(recipientResearch("thrivemarket.com", "Scott Lescher"));
  assert.equal(recipientResearch("thrivemarket.com", "Nick Green"), undefined);
});
