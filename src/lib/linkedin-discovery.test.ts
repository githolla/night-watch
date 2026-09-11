import assert from "node:assert/strict";
import test from "node:test";
import { aboutAi, discoverLinkedIn, parsePost, parseProfile } from "./linkedin-discovery.ts";

test("a profile result names the person, their title and the company", () => {
  const hit = { title: "Dana Ortiz - Chief Technology Officer - Acquia | LinkedIn", url: "https://www.linkedin.com/in/dana-ortiz?trk=x", snippet: "Boston, MA · Acquia", date: null };
  assert.deepEqual(parseProfile(hit, "Acquia"), { name: "Dana Ortiz", title: "Chief Technology Officer", company: "Acquia", url: "https://www.linkedin.com/in/dana-ortiz" });
  assert.equal(parseProfile({ ...hit, title: "Dana Ortiz - CTO - Other Corp | LinkedIn", snippet: "" }, "Acquia"), null);
  assert.equal(parseProfile({ ...hit, url: "https://www.linkedin.com/company/acquia" }, "Acquia"), null);
  // The company can also come from the snippet, and "Inc." does not matter.
  assert.equal(parseProfile({ title: "Priya Raman – VP Operations | LinkedIn", url: "https://linkedin.com/in/priya", snippet: "VP Operations at Acquia Inc.", date: null }, "Acquia")?.title, "VP Operations");
});

test("a post result gives the author and the first lines", () => {
  const post = parsePost({ title: "Dana Ortiz on LinkedIn: We just shipped our first internal AI agent for claims intake and", url: "https://www.linkedin.com/posts/dana-ortiz_ai-activity-123?utm=1", snippet: "the team cut handling time in half. Hiring for more of this.", date: "2026-09-02" });
  assert.equal(post?.author, "Dana Ortiz");
  assert.equal(post?.kind, "post");
  assert.match(post!.excerpt, /^We just shipped our first internal AI agent/);
  assert.equal(post?.url, "https://www.linkedin.com/posts/dana-ortiz_ai-activity-123");
  assert.equal(post?.date, "2026-09-02");
  assert.ok(aboutAi(post!.excerpt));
  assert.equal(parsePost({ title: "Acquia hiring", url: "https://www.linkedin.com/jobs/view/1", snippet: "", date: null }), null);
  assert.equal(parsePost({ title: "Thoughts on data platforms", url: "https://www.linkedin.com/pulse/thoughts-data-platforms-dana-ortiz", snippet: "Long article about building the platform.", date: null })?.kind, "article");
});

test("discovery runs the queries and merges people and posts", async () => {
  const seen: string[] = [];
  const fake = async (queries: string[]) => {
    const out: Record<string, Array<{ title: string; url: string; snippet: string; date: string | null }>> = {};
    for (const query of queries) {
      seen.push(query);
      out[query] = query.includes("linkedin.com/in") ? [{ title: "Dana Ortiz - CTO - Acquia | LinkedIn", url: "https://www.linkedin.com/in/dana-ortiz", snippet: "", date: null }]
        : query.includes("linkedin.com/posts") ? [{ title: "Dana Ortiz on LinkedIn: Automation is finally paying off for our ops team this quarter", url: "https://www.linkedin.com/posts/dana-ortiz_activity-1", snippet: "", date: null }]
        : [];
    }
    return out;
  };
  const result = await discoverLinkedIn("Acquia", ["CTO", "COO"], ["Dana Ortiz"], fake);
  assert.equal(result.people.length, 1);
  assert.equal(result.posts.length, 1);
  assert.ok(seen.some((query) => query.startsWith('site:linkedin.com/posts "Dana Ortiz"')));
});
