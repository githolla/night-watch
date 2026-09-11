import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeName, peopleFromHtml, scrapeTeamPeople, teamLinks } from "./team-page.ts";

const page = `<html><body><nav><a href="/about">About</a><a href="/leadership">Our Leadership</a></nav>
<section class="team">
  <div class="member"><h3>Chaim Indig</h3><p>Chief Executive Officer</p><a href="https://www.linkedin.com/in/chaim">LinkedIn</a></div>
  <div class="member"><h3>Priya Raman, CPA</h3><p>Chief Financial Officer</p></div>
  <div class="member"><h3>Read More</h3><p>About our services</p></div>
  <div class="member"><h3>Jordan Lee</h3><p>Learn more about Jordan's story and background over the years at the firm and beyond.</p><p>VP Operations</p></div>
</section>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","employee":[{"@type":"Person","name":"Dana Ortiz","jobTitle":"Chief Technology Officer","sameAs":["https://www.linkedin.com/in/dana-ortiz"]}]}</script>
<footer>Copyright 2026 Example Inc. All Rights Reserved</footer></body></html>`;

test("names and titles come out of a team page, junk stays out", () => {
  const people = peopleFromHtml(page, "https://www.example.com/leadership");
  assert.deepEqual(people.map((person) => [person.name, person.title]), [
    ["Dana Ortiz", "Chief Technology Officer"],
    ["Chaim Indig", "Chief Executive Officer"],
    ["Priya Raman", "Chief Financial Officer"],
    ["Jordan Lee", "VP Operations"],
  ]);
  assert.equal(people[0].linkedin_url, "https://www.linkedin.com/in/dana-ortiz");
  assert.ok(looksLikeName("Mary-Ann O'Neil"));
  assert.ok(!looksLikeName("Contact Us"));
  assert.ok(!looksLikeName("Chief Executive Officer"));
});

test("leadership links are found on a homepage and followed", async () => {
  assert.deepEqual(teamLinks(page, "https://www.example.com/"), ["https://www.example.com/leadership"]);
  const pages: Record<string, string> = { "https://www.example.com/": page, "https://www.example.com/leadership": page };
  const fetcher = async (url: string) => ({ ok: url in pages, status: url in pages ? 200 : 404, text: async () => pages[url] ?? "" });
  const result = await scrapeTeamPeople("example.com", fetcher);
  assert.equal(result.people.length, 4);
  assert.ok(result.pagesRead >= 2);
});
