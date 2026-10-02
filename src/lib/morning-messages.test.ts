import test from "node:test";
import assert from "node:assert/strict";
import { announceBlocks, bouncePauseText, buildFailureText, listProblemAlert, shouldSendMorningDigest, SLACK_MAX_BLOCKS, SLACK_MAX_SECTION, summaryBlocks, windowWarningText, type SlackBlock, type SlackMessage } from "./morning-messages.ts";

const window = { owner: "suuchi", baseUrl: "https://nw.test", sendFrom: 9 * 60, sendUntil: 11 * 60 + 30, size: 12 };
const row = (index: number, deliverable: boolean, extra: Record<string, unknown> = {}) => ({
  company: `Company ${index} & Sons`, domain: `c${index}.test`, rank: index, sector: "wholesale distribution",
  aiFit: { score: 90 - index, summary: `Hiring three dispatchers <urgent> for branch ${index}`, reasons: [], disqualified: null },
  emailCheck: deliverable ? { level: "deliverable", reason: "Hunter verified this address." } : { level: "risky", reason: "The domain accepts every address, so it cannot be confirmed." },
  ...extra,
});
const cards = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`c${index + 1}.test`, `card-${index + 1}`]));

function assertWithinLimits(message: SlackMessage) {
  assert.ok(message.blocks.length <= SLACK_MAX_BLOCKS, `${message.blocks.length} blocks`);
  for (const block of message.blocks) {
    const text = (block as { text?: { text?: string } }).text?.text ?? ((block as { elements?: Array<{ text: string }> }).elements ?? []).map((element) => element.text).join("");
    assert.ok(text.length <= SLACK_MAX_SECTION, `section of ${text.length} characters`);
  }
  assert.ok(message.text.length > 0, "a plain-text fallback is always present");
  assert.doesNotMatch(JSON.stringify(message), /edited after the hold/);
}
const allText = (blocks: SlackBlock[]) => JSON.stringify(blocks);

test("all sending: header counts, one linked line per company in list order", () => {
  const rows = [row(2, true), row(1, true), row(3, true)];
  const message = announceBlocks(rows, cards(3), null, { ...window, size: 3 });
  assertWithinLimits(message);
  assert.match(message.text, /^3 expected to auto-send 9:00 to 11:30, 0 need you/);
  const body = allText(message.blocks);
  assert.match(body, /<https:\/\/nw\.test\/outreach\?list=suuchi&batch=today&card=card-1\|Company 1 &amp; Sons>/);
  assert.match(body, /fit 89/);
  assert.match(body, /&lt;urgent&gt;/, "Slack control characters are escaped");
  assert.match(body, /wholesale distribution/);
  assert.match(body, /expected to send/);
  assert.doesNotMatch(body, /held:/);
});

test("mixed: held rows carry their reason, and identity holds win over a good address", () => {
  const rows = [row(1, true), row(2, false), row(3, true, { identityHold: "the buyer's title is not confirmed" })];
  const message = announceBlocks(rows, cards(3), null, window);
  assertWithinLimits(message);
  assert.match(message.text, /^1 expected to auto-send 9:00 to 11:30, 2 need you/);
  assert.match(message.text, /The list is short: 3 of 12/);
  const body = allText(message.blocks);
  assert.match(body, /held: The domain accepts every address/);
  assert.match(body, /held: the buyer's title is not confirmed/);
});

test("blocked: nothing sends and the header says why", () => {
  const message = announceBlocks([row(1, true), row(2, true)], cards(2), "auto-send is paused", window);
  assertWithinLimits(message);
  assert.match(message.text, /Nothing sends automatically: auto-send is paused/);
  assert.doesNotMatch(allText(message.blocks), /expected to send/);
  assert.match(allText(message.blocks), /send by hand/);
});

test("twelve rows with long reasons stay within Slack limits", () => {
  const long = "x".repeat(900);
  const rows = Array.from({ length: 12 }, (_, index) => row(index + 1, index % 2 === 0, { company: `${long}${index}`, aiFit: { score: 70, summary: long, reasons: [] } }));
  const message = announceBlocks(rows, cards(12), null, window);
  assertWithinLimits(message);
  const many = announceBlocks(Array.from({ length: 200 }, (_, index) => row(index + 1, true, { company: long })), {}, null, window);
  assertWithinLimits(many);
});

test("summary names each held card with its reason and the cards kept by hand", () => {
  const message = summaryBlocks(7, [{ company: "Acme", reason: "Daily sender cap of 40 reached" }, { company: "Beta", reason: "not reached before the send window closed" }], 2, { owner: "josh", baseUrl: "https://nw.test" });
  assertWithinLimits(message);
  assert.match(message.text, /^Josh's morning send is done: 7 sent automatically, 2 kept by you to send by hand, 2 left on the list/);
  assert.match(allText(message.blocks), /Acme\*: Daily sender cap of 40 reached/);
  const clean = summaryBlocks(12, [], 0, { owner: "josh", baseUrl: "https://nw.test" });
  assert.equal(clean.text.split("\n")[0], "Josh's morning send is done: 12 sent automatically.");
});

test("missing, building and failed lists each produce a clear alert", () => {
  const missing = listProblemAlert("suuchi", "missing", 0, 12, [], { baseUrl: "https://nw.test" });
  const building = listProblemAlert("suuchi", "building", 5, 12, ["AI fit 20 is below 40 (4)"], { baseUrl: "https://nw.test" });
  const failed = listProblemAlert("josh", "failed", 0, 12, ["research failed: overloaded", "excluded sector", "rejected: closed", "fourth"], { baseUrl: "https://nw.test" });
  for (const message of [missing, building, failed]) assertWithinLimits(message);
  assert.match(missing.text, /No list for Suuchi today: the nightly build never started \(0 of 12/);
  assert.match(building.text, /did not finish \(5 of 12 companies\).*Top reasons: AI fit 20 is below 40 \(4\)/);
  assert.match(failed.text, /No list for Josh today: the nightly build failed/);
  assert.doesNotMatch(failed.text, /fourth/, "only the top three reasons");
  assert.match(failed.text, /Desk: https:\/\/nw\.test\/outreach\?list=josh&batch=today/);
});

test("a seat with a ready list gets no 8:00 digest; a seat without one still does", () => {
  assert.equal(shouldSendMorningDigest("josh", "ready"), false);
  assert.equal(shouldSendMorningDigest("suuchi", null), true);
  assert.equal(shouldSendMorningDigest("suuchi", undefined), true);
  assert.equal(shouldSendMorningDigest("suuchi", "failed"), true);
  assert.equal(shouldSendMorningDigest("suuchi", "building"), true);
});

test("pause, failure and window warnings are plain text with the details an operator needs", () => {
  const pause = bouncePauseText("josh", "2 first emails bounced in the last 48 hours.", Array.from({ length: 7 }, (_, index) => ({ email: `p${index}@a.test`, company: `A${index}` })), 4, { list: "https://nw.test/list", settings: "https://nw.test/settings" });
  assert.match(pause, /^Auto-send paused for Josh: 2 first emails bounced/);
  assert.match(pause, /p0@a\.test \(A0\).*p4@a\.test \(A4\) and 2 more\./);
  assert.match(pause, /4 of today's list still unsent: https:\/\/nw\.test\/list/);
  assert.match(pause, /resume in Settings: https:\/\/nw\.test\/settings/);
  assert.match(buildFailureText(new Error("Could not read tonight's lists: timeout")), /^The nightly list build failed: Could not read tonight's lists: timeout\./);
  assert.match(buildFailureText("boom", "The morning send"), /^The morning send failed: boom/);
  assert.equal(windowWarningText([]), null);
  assert.match(windowWarningText(["sending starts before 10:00 UTC"]) ?? "", /vercel\.json/);
});
