import test from "node:test";
import assert from "node:assert/strict";
import { publishedPhones, researchCompanyPhone } from "./phone-research.ts";
test("public telephone links are sourced company numbers, never presumed personal lines", () => {
  const phones = publishedPhones('<a href="tel:+18005551234">Call us</a><a href="tel:+18005551234">Contact</a><script>tel:12345</script>', "https://acme.test/contact");
  assert.equal(phones.length, 1);
  assert.equal(publishedPhones('<p>Phone: (800) 555-1234</p><p>Fax: (800) 555-5678</p>', "https://acme.test").length, 1);
  assert.equal(publishedPhones('<a href="tel:8005551234">Phone</a> Fax: <a href="tel:8005555678">fax</a>', "https://acme.test").length, 1);
  assert.equal(phones[0].kind, "company");
  assert.equal(phones[0].sourceUrl, "https://acme.test/contact");
  assert.equal(publishedPhones('<a href="tel:123">123</a>', "https://acme.test").length, 0);
  assert.equal(publishedPhones('Fax <a href="tel:8005551234">fax</a>', "https://acme.test").length, 0);
});
test("research keeps ambiguous branch numbers unresolved and refuses redirected external publishers", async () => {
  const phone = await researchCompanyPhone("acme.test", { lookup: async () => ["93.184.216.34"], fetcher: async () => new Response('<a href="tel:8005551234">Branch A</a><a href="tel:8005555678">Branch B</a>') });
  assert.equal(phone, null);
});
