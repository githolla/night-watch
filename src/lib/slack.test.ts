import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { buildDeskBlocks, verifySlackRequest, type SlackDeskCard } from "./slack.ts";

test("Slack signatures are verified and stale requests are rejected", () => {
  const previous = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
  const body = "user_id=U123&command=%2Fnight-watch";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `v0=${createHmac("sha256", "test-signing-secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const request = new Request("https://example.com/api/slack/commands", {
    method: "POST",
    headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature },
  });
  assert.equal(verifySlackRequest(request, body), true);

  const stale = (Number(timestamp) - 301).toString();
  const staleSignature = `v0=${createHmac("sha256", "test-signing-secret").update(`v0:${stale}:${body}`).digest("hex")}`;
  const staleRequest = new Request("https://example.com/api/slack/commands", {
    method: "POST",
    headers: { "x-slack-request-timestamp": stale, "x-slack-signature": staleSignature },
  });
  assert.equal(verifySlackRequest(staleRequest, body), false);
  if (previous === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = previous;
});

test("a full morning desk stays inside Slack's 50-block message limit", () => {
  const card: SlackDeskCard = {
    id: "00000000-0000-0000-0000-000000000001",
    score: 91,
    status: "new",
    channel: "linkedin_first",
    why_now: "A verified operating change created a timely reason to talk.",
    assigned_to: "josh",
    accounts: { name: "Northstar" },
    people: { full_name: "Maya Chen", title: "VP, Operations" },
    signals: { summary: "Northstar announced a workflow redesign.", source_url: "https://example.com/source", type: "exec_post" },
  };
  const blocks = buildDeskBlocks(Array.from({ length: 20 }, (_, index) => ({ ...card, id: `${card.id.slice(0, -2)}${String(index).padStart(2, "0")}` })));
  assert.ok(blocks.length <= 50);
});

test("Slack status tests the deployed credential instead of treating presence as connection", async () => {
  const { slackConnectionStatus } = await import("./slack.ts");
  const token = process.env.SLACK_BOT_TOKEN, channel = process.env.SLACK_CHANNEL_ID;
  process.env.SLACK_BOT_TOKEN = "test-token"; process.env.SLACK_CHANNEL_ID = "C_TEST";
  try {
    const failed = await slackConnectionStatus(async () => Response.json({ ok: false, error: "invalid_auth" }));
    assert.deepEqual(failed, { connected: false, error: "invalid_auth" });
    const calls: string[] = [];
    const connected = await slackConnectionStatus(async input => {
      calls.push(String(input));
      return Response.json(String(input).endsWith("auth.test") ? { ok: true, team: "Nine-67", team_id: "T_TEST" } : { ok: true, channel: { name: "nightwatch" } });
    });
    assert.equal(connected.connected, true); assert.equal(connected.channelName, "nightwatch"); assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(connected).includes("test-token"), false);
  } finally {
    if (token === undefined) delete process.env.SLACK_BOT_TOKEN; else process.env.SLACK_BOT_TOKEN = token;
    if (channel === undefined) delete process.env.SLACK_CHANNEL_ID; else process.env.SLACK_CHANNEL_ID = channel;
  }
});
