import test from "node:test";
import assert from "node:assert/strict";
import { excludedCompanyPhone } from "./company-phone-safety.ts";
import { publishedPhones } from "./phone-research.ts";
test("public emergency resources on a company website cannot become outreach numbers", () => {
  assert.equal(excludedCompanyPhone("1-800-222-1222"), true);
  assert.equal(excludedCompanyPhone("(800) 222-1222 ext 1"), true);
  assert.equal(excludedCompanyPhone("(717) 299-5641"), false);
  assert.deepEqual(publishedPhones('<a href="tel:18002221222">Poison Control</a>', "https://example.test"), []);
});
