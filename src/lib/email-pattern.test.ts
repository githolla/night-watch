import assert from "node:assert/strict";
import test from "node:test";
import { buildEmail, detectPattern, guessFromExamples, splitName } from "./email-pattern.ts";

test("names split without credentials or suffixes", () => {
  assert.deepEqual(splitName("John Smith"), { first: "john", last: "smith" });
  assert.deepEqual(splitName("Mary-Ann O'Neil, CPA"), { first: "maryann", last: "oneil" });
  assert.deepEqual(splitName("José Álvarez Jr."), { first: "jose", last: "alvarez" });
  assert.deepEqual(splitName("Dr. Priya Raman (she/her)"), { first: "dr", last: "raman" });
  assert.equal(splitName("Madonna"), null);
});

test("a known address reveals the pattern and builds the next one", () => {
  const guess = detectPattern([{ name: "John Smith", email: "john.smith@example.com" }, { name: "Priya Raman", email: "priya.raman@example.com" }], "example.com");
  assert.equal(guess?.key, "first.last");
  assert.equal(guess?.confidence, 0.8);
  assert.equal(buildEmail("Chaim Indig", guess!.key, "example.com"), "chaim.indig@example.com");
});

test("initial plus last name is recognised, and other-domain or generic addresses are ignored", () => {
  const guess = detectPattern([
    { name: "John Smith", email: "jsmith@example.com" },
    { name: "Info Desk", email: "info@example.com" },
    { name: "Priya Raman", email: "praman@partner.io" },
  ], "example.com");
  assert.equal(guess?.key, "flast");
  assert.equal(guess?.matched, 1);
  assert.equal(guess?.confidence, 0.6);
});

test("disagreeing samples lower confidence", () => {
  const guess = detectPattern([
    { name: "John Smith", email: "john.smith@example.com" },
    { name: "Priya Raman", email: "praman@example.com" },
  ], "example.com");
  assert.equal(guess?.key, "first.last");
  assert.ok(guess!.confidence < 0.6);
});

test("bare addresses seen on the web give a weaker guess", () => {
  assert.equal(guessFromExamples(["press@example.com", "jane.doe@example.com"], "example.com")?.key, "first.last");
  assert.equal(guessFromExamples(["jdoe@example.com"], "example.com")?.key, "flast");
  assert.equal(guessFromExamples(["info@example.com"], "example.com"), null);
});
