import assert from "node:assert/strict";
import test from "node:test";
import { findAddress, namesBefore } from "./address-finder.ts";

const site = (pages: Record<string, string>) => async (url: string) => new Response(pages[url.replace(/\/$/, "")] ?? "", { status: pages[url.replace(/\/$/, "")] !== undefined ? 200 : 404, headers: { "content-type": "text/html" } });
const deps = (pages: Record<string, string>) => ({ fetcher: site(pages), lookup: async () => ["93.184.216.34"], mailHost: async () => true });

test("their own published address wins, in whatever format the company uses", async () => {
  const result = await findAddress({ name: "Kurt LaButte", domain: "todds.test", avoid: "kurt.labutte@todds.test" }, deps({
    "https://todds.test": `<a href="/our-story/leadership">Leadership</a>`,
    "https://todds.test/our-story/leadership": "<p>Kurt LaButte, President – klabutte@todds.test</p>",
  }));
  assert.deepEqual(result, { kind: "evidence", evidence: { kind: "published", address: "klabutte@todds.test", sourceUrl: "https://todds.test/our-story/leadership" } });
});

test("two named colleagues prove the format, which corrects a wrong guess", async () => {
  const result = await findAddress({ name: "Monty Khouri", domain: "pierre.test", avoid: "monty.khouri@pierre.test" }, deps({
    "https://pierre.test": "<p>Welcome</p>",
    "https://pierre.test/team": "<li>Jane Roe, Office Manager: jroe@pierre.test</li><li>Sam Patel, Estimator: spatel@pierre.test</li><li>info@pierre.test</li>",
  }));
  assert.equal(result.kind, "evidence");
  assert.deepEqual(result.kind === "evidence" && result.evidence, { kind: "format", address: "mkhouri@pierre.test", examples: [{ name: "Jane Roe", email: "jroe@pierre.test", sourceUrl: "https://pierre.test/team" }, { name: "Sam Patel", email: "spatel@pierre.test", sourceUrl: "https://pierre.test/team" }] });
});

test("shared inboxes and one colleague prove nothing; a domain with no mail is flagged", async () => {
  const none = await findAddress({ name: "Pat Lee", domain: "quiet.test" }, deps({ "https://quiet.test": "<p>info@quiet.test sales@quiet.test Jane Roe jroe@quiet.test</p>" }));
  assert.equal(none.kind, "none");
  assert.equal((await findAddress({ name: "Pat Lee", domain: "dead.test" }, { ...deps({}), mailHost: async () => false })).kind, "no-mail");
});

test("a bounced address is never offered back", async () => {
  const result = await findAddress({ name: "Pat Lee", domain: "x.test", avoid: "pat.lee@x.test" }, deps({ "https://x.test": "<p>Pat Lee pat.lee@x.test</p>" }));
  assert.equal(result.kind, "none");
});

test("names are read nearest first", () => {
  const names = namesBefore("Call Sam Patel or Jane Roe, Office Manager: ");
  assert.ok(names.indexOf("Jane Roe") >= 0 && names.indexOf("Sam Patel") > names.indexOf("Jane Roe"), names.join(" | "));
  assert.ok(namesBefore("David R. Frank, CEO ").includes("David R. Frank"));
});
