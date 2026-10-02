import assert from "node:assert/strict";
import test from "node:test";
import type { Fetcher, Lookup } from "./evidence-grounding.ts";
import { nameTokens, namesCompany, registrableDomain, verifySite } from "./site-check.ts";

const lookup: Lookup = async (host) => {
  if (host.startsWith("dead")) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  return ["93.184.216.34"];
};

/** Routes by URL; a string value redirects there, a number answers with that status and an empty page. */
function site(routes: Record<string, string | number | { html: string }>): Fetcher {
  return async (url) => {
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch ${url}`);
    if (typeof route === "string") return new Response(null, { status: 301, headers: { location: route } });
    if (typeof route === "number") return new Response("", { status: route });
    return new Response(route.html, { status: 200, headers: { "content-type": "text/html" } });
  };
}

const page = (title: string, body = "") => ({ html: `<html><head><title>${title}</title></head><body>${body}</body></html>` });

test("a redirect to a social or parking host drops the row", async () => {
  const social = await verifySite("acme-landscaping.com", "Acme Landscaping", site({ "https://acme-landscaping.com/": "https://www.facebook.com/acme" }), { lookup });
  assert.equal(social.action, "drop");
  const parked = await verifySite("acme-landscaping.com", "Acme Landscaping", site({ "https://acme-landscaping.com/": "https://www.hugedomains.com/domain_profile.cfm?d=acme" }), { lookup });
  assert.equal(parked.action, "drop");
});

test("a rebrand redirect switches the candidate to the new domain", async () => {
  const fetcher = site({ "https://oldacme.com/": "https://www.acmegreen.com/home", "https://www.acmegreen.com/home": page("Acme Green | Commercial Landscaping") });
  const result = await verifySite("oldacme.com", "Acme Landscaping", fetcher, { lookup });
  assert.deepEqual(result, { action: "keep", domain: "acmegreen.com", confirmed: true, movedFrom: "oldacme.com" });
});

test("a redirect within the same domain is not a move", async () => {
  const fetcher = site({ "https://acme.com/": "https://www.acme.com/", "https://www.acme.com/": page("Acme Landscaping") });
  assert.deepEqual(await verifySite("acme.com", "Acme Landscaping", fetcher, { lookup }), { action: "keep", domain: "acme.com", confirmed: true });
});

test("a 200 page that never names the company drops the row", async () => {
  const fetcher = site({ "https://brightpath.com/": page("Welcome to our site", "<p>Quality plumbing since 1990.</p>") });
  const result = await verifySite("brightpath.com", "Summit Mechanical", fetcher, { lookup });
  assert.equal(result.action, "drop");
});

test("the name may appear in the footer, og:site_name or the domain label", async () => {
  const footer = site({ "https://smi.com/": { html: `<title>Home</title><body>${"x ".repeat(100)}<footer>&copy; 2026 Summit Mechanical, Inc.</footer></body>` } });
  assert.equal((await verifySite("smi.com", "Summit Mechanical Inc", footer, { lookup })).action, "keep");
  assert.equal(namesCompany(`<meta property="og:site_name" content="Summit Mechanical">`, "smi.com", "Summit Mechanical"), true);
  assert.equal(namesCompany("<title>Home</title>", "summitmech.com", "Summit Mechanical Group"), true);
});

test("a 403, a 429, a 5xx or a timeout keeps the row as unconfirmed", async () => {
  for (const status of [403, 429, 503]) {
    const result = await verifySite("acme.com", "Acme", site({ "https://acme.com/": status }), { lookup });
    assert.equal(result.action, "unconfirmed", String(status));
  }
  const slow: Fetcher = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const timedOut = await verifySite("acme.com", "Acme", slow, { lookup, timeoutMs: 20 });
  assert.equal(timedOut.action, "unconfirmed");
});

test("a domain that does not resolve or refuses the connection is dropped", async () => {
  assert.equal((await verifySite("deadco.com", "Dead Co", site({}), { lookup })).action, "drop");
  const refused: Fetcher = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
  assert.equal((await verifySite("acme.com", "Acme", refused, { lookup })).action, "drop");
});

test("a domain whose MX check says it takes no email is dropped", async () => {
  const fetcher = site({ "https://acme.com/": page("Acme Landscaping") });
  assert.equal((await verifySite("acme.com", "Acme Landscaping", fetcher, { lookup, mailHost: async () => false })).action, "drop");
  assert.equal((await verifySite("acme.com", "Acme Landscaping", fetcher, { lookup, mailHost: async () => null })).action, "keep", "could not tell is not a drop");
});

test("registrable domains and name tokens", () => {
  assert.equal(registrableDomain("shop.acme.com"), "acme.com");
  assert.equal(registrableDomain("www.acme.co.uk"), "acme.co.uk");
  assert.deepEqual(nameTokens("The Acme Group, LLC"), ["acme"]);
  assert.deepEqual(nameTokens("Smith & Sons Services"), ["smith", "sons"]);
});
