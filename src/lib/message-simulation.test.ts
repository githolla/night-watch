import test from "node:test";
import assert from "node:assert/strict";
import { createChallenger, simulateHeuristically, type SimulationInput } from "./message-simulation.ts";

const base = {
  personName: "Maya Chen",
  company: "Northstar Health",
  signalSummary: "Maya described an effort to automate patient intake while keeping exception handling human-led.",
};

test("connection challengers stay within LinkedIn's note limit", () => {
  const challenger = createChallenger({ ...base, channel: "connection", control: { label: "A", subject: "", body: "Saw your post about intake automation and exception ownership." } });
  assert.ok(challenger.body.length <= 300);
});

test("simulation returns two scored variants and a four-person room", () => {
  const input: SimulationInput = {
    ...base,
    channel: "email",
    goal: "Which message is easiest to answer?",
    context: "The prospect is actively redesigning intake workflows.",
    focusAreas: ["relevance", "trust"],
    variants: [
      { label: "A", subject: "intake", body: "Maya — we offer amazing transformative solutions. Can we book 30 minutes?" },
      { label: "B", subject: "intake exceptions", body: "Maya — your point about human-owned intake exceptions stood out. Would a one-page operating pattern be useful?" },
    ],
  };
  const result = simulateHeuristically(input);
  assert.equal(result.variants.length, 2);
  assert.equal(result.panel.length, 4);
  assert.equal(result.winner, "B");
});
