import test from "node:test";
import assert from "node:assert/strict";
import { matchingVerifiedBuyer } from "./send-queue-recovery.ts";
const match = { first_name: "Jane", last_name: "Doe", title: "CEO", linkedin_url: null, email: "jane.doe@company.com", email_status: "verified", currentDomain: "company.com", currentCompany: "Company", stillHere: true };
test("recovery accepts an exact verified buyer at their current employer", () => { assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", match), true); });
test("recovery refuses names, roles and employers that do not match", () => { assert.equal(matchingVerifiedBuyer("John Doe", "company.com", match), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "other.com", match), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", { ...match, currentDomain: null }), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", { ...match, stillHere: false }), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", { ...match, email: "info@company.com" }), false); });
test("catch-all and uncertain provider responses cannot become verified", () => { assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", { ...match, email_status: "catch_all" }), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", null), false); });
