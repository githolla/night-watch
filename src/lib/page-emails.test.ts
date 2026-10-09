import assert from "node:assert/strict";
import test from "node:test";
import { decodeCfEmail, pageEmails, pageShowsAddress } from "./page-emails.ts";

// Cloudflare-style encoding with key 0x42.
const cf = (email: string, key = 0x42) => key.toString(16).padStart(2, "0") + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");

test("addresses hidden by Cloudflare, entities and encoded mailto links are found", () => {
  assert.equal(decodeCfEmail(cf("kurt@toddsservices.com")), "kurt@toddsservices.com");
  const html = `<p>Kurt LaButte, President <a href="/cdn-cgi/l/email-protection#${cf("klabutte@toddsservices.com")}">[email protected]</a></p>
    <p>Jane Roe <span class="__cf_email__" data-cfemail="${cf("jroe@toddsservices.com")}">[email&#160;protected]</span></p>
    <p>Sam Lee sam&#64;toddsservices&#46;com</p><a href="mailto:pat%2Ekim@toddsservices.com">Pat Kim</a>
    <p>info@toddsservices.com</p><p>someone@other.com</p>`;
  const found = pageEmails(html, "toddsservices.com").map((item) => item.email).sort();
  assert.deepEqual(found, ["info@toddsservices.com", "jroe@toddsservices.com", "klabutte@toddsservices.com", "pat.kim@toddsservices.com", "sam@toddsservices.com"]);
  assert.ok(pageShowsAddress(html, "klabutte@toddsservices.com"));
  assert.ok(!pageShowsAddress(html, "kurt.labutte@toddsservices.com"));
});

test("the text before an address is kept, so a name next to it can be read", () => {
  const [item] = pageEmails("<li><b>Jane Roe</b>, Office Manager – jroe@acme.test</li>", "acme.test");
  assert.match(item.before, /Jane Roe\s*, Office Manager/);
});
