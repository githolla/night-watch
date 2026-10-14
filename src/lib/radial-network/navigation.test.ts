import test from "node:test";
import assert from "node:assert/strict";
import { visibleInView, viewForType } from "./navigation.ts";
test("overview shows only company hubs regardless of detail tab", () => { for (const view of ["contacts", "outreach", "research", "all"] as const) { assert.equal(visibleInView("company", false, view), true); for (const type of ["person", "email", "outreach", "source", "date"]) assert.equal(visibleInView(type, false, view), false); } });
test("company tabs reveal relevant records without mixing all categories", () => { assert.equal(visibleInView("email", true, "contacts"), true); assert.equal(visibleInView("bounce", true, "contacts"), false); assert.equal(visibleInView("bounce", true, "outreach"), true); assert.equal(visibleInView("source", true, "outreach"), false); assert.equal(visibleInView("source", true, "research"), true); assert.equal(visibleInView("date", true, "all"), true); });
test("search opens the tab needed to see the chosen record", () => { for (const type of ["person", "email", "draft", "outreach", "reply", "bounce", "signal", "job", "post", "source", "date"]) assert.equal(visibleInView(type, true, viewForType(type)), true); });
