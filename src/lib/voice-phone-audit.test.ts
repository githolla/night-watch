import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVoicePhone, parsePhoneLine } from "./voice-phone-audit.ts";

test("phone audit normalizes a US business line without treating the extension as part of the number", () => {
  assert.equal(normalizeVoicePhone("704-434-9411 ext 2"), "+17044349411");
  assert.equal(normalizeVoicePhone("+1 716 694 0800"), "+17166940800");
  assert.equal(normalizeVoicePhone("+442079460958"), null);
});
test("carrier data is bound to the queried number and must be valid and error-free", () => {
  const result = { phone_number: "+17166940800", valid: true, line_type_intelligence: { type: "landline", carrier_name: "Carrier", error_code: null } };
  assert.equal(parsePhoneLine(result, "+17166940800").lineType, "landline");
  assert.throws(() => parsePhoneLine(result, "+17177255050"));
  assert.throws(() => parsePhoneLine({ ...result, valid: false }, "+17166940800"));
  assert.throws(() => parsePhoneLine({ ...result, line_type_intelligence: { ...result.line_type_intelligence, error_code: 60601 } }, "+17166940800"));
});
