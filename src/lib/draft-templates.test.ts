import assert from "node:assert/strict";
import test from "node:test";
import { currentTemplates } from "./draft-templates.ts";

const row = (first: string, company: string, greeting: string, subject: string) => ({ first, company, subject, body: `${greeting}\n\nFor ${company}, one idea.` });

test("the greeting and subject in use are read back from the drafts as templates", () => {
  const rows = [row("Dana", "Acme", "Hello Dana,", "An idea for Acme"), row("Lee", "Birch Co", "Hello Lee,", "An idea for Birch Co"), row("Sam", "Cedar", "Hello Sam,", "An idea for Cedar")];
  assert.deepEqual(currentTemplates(rows), { greeting: "Hello {first},", subject: "An idea for {company}", subjectExample: "An idea for Acme" });
});

test("when each email has its own subject, there is no shared one to show", () => {
  const rows = [row("Dana", "Acme", "Hi Dana,", "dispatch handoffs at Acme"), row("Lee", "Birch", "Hi Lee,", "quoting at Birch"), row("Sam", "Cedar", "Hi Sam,", "billing follow-up at Cedar")];
  const current = currentTemplates(rows);
  assert.equal(current.greeting, "Hi {first},");
  assert.equal(current.subject, null);
  assert.equal(current.subjectExample, "dispatch handoffs at Acme");
});

test("no drafts, nothing in use", () => {
  assert.deepEqual(currentTemplates([]), { greeting: null, subject: null, subjectExample: null });
});
