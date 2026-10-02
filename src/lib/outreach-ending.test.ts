import test from "node:test";
import assert from "node:assert/strict";
import { outreachBody, outreachFooterHtml, withOutreachSignature, outreachEmailHtml, senderFirstName, withOutreachName } from "./outreach-ending.ts";
import { composeContactDraft } from "./contact-draft.ts";

test("curated draft ends at its CTA despite saved pleasantry", () => {
  const draft = composeContactDraft({ company: "G&W Electric", domain: "gwelectric.com", personName: "Dave Gizewicz", personTitle: "COO", senderName: "Josh Lee", signoff: "Thank you," });
  assert.match(draft.body, /\?$/);
  assert.doesNotMatch(draft.body, /Thank you|Regards|Best,/);
});

test("name comes from sender settings, with plain and HTML signature fallback", () => {
  assert.equal(senderFirstName({ fromName: "Suuchi Ramesh", signature: "Josh Lee" }), "Suuchi");
  assert.equal(senderFirstName({ fromName: "", signature: "Thanks,\nJosh Lee\nCOO" }), "Josh");
  assert.equal(senderFirstName({ fromName: "", signature: "<div>Suuchi Ramesh</div><div>CEO</div>" }), "Suuchi");
  assert.equal(senderFirstName({ fromName: "" }), "");
});

test("legacy signoff and full signature are replaced once, after final CTA", () => {
  const original = "Hi Dave,\n\nWhat is slowing orders? We would examine one handoff.\n\nIs this worth a look?\n\nBest,\nJosh Lee\nCOO\nnine-67.com";
  const expected = "Hi Dave,\n\nWhat is slowing orders? We would examine one handoff.\n\nIs this worth a look?\n\nJosh";
  assert.equal(withOutreachName(original, { fromName: "Josh Lee" }), expected);
  assert.equal(withOutreachName(expected, { fromName: "Josh Lee" }), expected);
  assert.match(outreachBody(original), /Is this worth a look\?$/);
  assert.doesNotMatch(outreachEmailHtml(original, { fromName: "Josh Lee" }), /Best,|COO|nine-67.com/);
});


test("uploaded footer survives outreach send rendering without restoring pleasantries", () => {
  const profile = { fromName: "Josh Lee", signature: '<table><tr><td>Josh Lee<br>COO · Nine-67</td><td><img src="https://example.com/logo.png" onerror="alert(1)"></td></tr></table>' };
  const body = "Hi Victor,\n\nWould this help?\n\nThanks,\nJosh";
  const html = outreachEmailHtml(body, profile);
  assert.match(html, /Would this help\?<br><br>Josh/);
  assert.match(html, /<table>/);
  assert.match(html, /https:\/\/example.com\/logo.png/);
  assert.doesNotMatch(html, /onerror|Thanks,/);
  assert.equal((html.match(/<table>/g) ?? []).length, 1);
  assert.match(withOutreachSignature(body, profile), /Josh Lee\nCOO · Nine-67/);
  assert.equal(outreachFooterHtml({ fromName: "Suuchi" }), "");
  assert.doesNotMatch(outreachEmailHtml(body, { fromName: "Suuchi" }), /Josh|<table>/);
});

test("the postal address closes the signature block instead of standing apart, and is never printed twice", () => {
  const html = '<table><tr><td style="font:12px Arial">Suuchi Rao<br>Partner, Nine-67</td></tr></table>';
  const profile = { fromName: "Suuchi Rao", signature: html, postalAddress: "123 Main St\nPittsburgh, PA 15222" };
  assert.match(withOutreachSignature("Hi Pat,\n\nIs this useful?", profile), /Partner, Nine-67\n123 Main St, Pittsburgh, PA 15222$/, "the address is the signature's last line, not a separate paragraph");
  const rendered = outreachEmailHtml("Hi Pat,\n\nIs this useful?", profile);
  assert.match(rendered, /<\/table><div style="margin-top:4px;[^"]*">123 Main St, Pittsburgh, PA 15222<\/div><\/div><\/div>$/, "inside the signature's container, directly under it");
  const written = { ...profile, signature: html.replace("Partner, Nine-67", "Partner, Nine-67<br>123 Main St, Pittsburgh PA 15222") };
  assert.equal(withOutreachSignature("Hi Pat,\n\nIs this useful?", written).match(/123 Main St/g)?.length, 1);
  assert.equal(outreachEmailHtml("Hi Pat,\n\nIs this useful?", written).match(/123 Main St/g)?.length, 1);
});
