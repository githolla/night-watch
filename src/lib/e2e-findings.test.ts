import assert from "node:assert/strict";
import test from "node:test";
import { isBounce } from "./bounce.ts";
import { optOutLine, unsubscribeUrl, withOptOut } from "./opt-out.ts";
import { decrypt } from "./crypto.ts";
import { issueSession, readSession } from "./session.ts";
import { assertCardSender, batchOwner } from "./focus-data.ts";
import { batchFocus } from "./focus-data.ts";
import { oauthStateCookie, readOAuthStateCookie } from "./gmail.ts";

process.env.TOKEN_ENCRYPTION_KEY ??= "test-encryption-key";

const h = (from: string, subject = "", contentType = "") => [{ name: "From", value: from }, { name: "Subject", value: subject }, { name: "Content-Type", value: contentType }];

test("delivery failures are recognised as bounces, real replies are not", () => {
  assert.equal(isBounce(h("Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "Delivery Status Notification (Failure)")), true);
  assert.equal(isBounce(h("postmaster@acme.test", "Undeliverable: order intake")), true);
  assert.equal(isBounce(h("Microsoft Outlook <noreply@acme.test>", "Undeliverable: order intake")), true);
  assert.equal(isBounce(h("someone@acme.test", "report", "multipart/report; report-type=delivery-status")), true);
  assert.equal(isBounce(h("Pat Lee <pat@acme.test>", "Re: order intake")), false);
  assert.equal(isBounce(h("Pat Lee <pat@acme.test>", "Re: message not delivered?")), false, "a person mentioning delivery is still a reply");
});

test("the opt-out is added to both parts outside the curated lists, and the unsubscribe link names the person", () => {
  const plain = withOptOut({ text: "Hi", html: "<p>Hi</p>" }, false);
  assert.ok(plain.text.endsWith(optOutLine()));
  assert.match(plain.html, /reply no and I won&#39;t|reply no and I won't/);
  assert.deepEqual(withOptOut({ text: "Hi", html: "<p>Hi</p>" }, true), { text: "Hi", html: "<p>Hi</p>" });
  const url = new URL(unsubscribeUrl("https://app.test/", "person-1"));
  assert.equal(url.pathname, "/api/unsubscribe");
  assert.equal(decrypt(url.searchParams.get("t")!), "person-1");
});

test("sessions carry an id and version; shared-password sessions die when the password changes", () => {
  const user = readSession(issueSession("u1", false, 4));
  assert.equal(user?.uid, "u1");
  assert.equal(user?.sv, 4);
  assert.ok(user?.jti && user.jti.length >= 12);
  assert.notEqual(readSession(issueSession("u1"))?.jti, user?.jti, "every session gets its own id");

  const previous = process.env.SHARED_PASSWORD;
  process.env.SHARED_PASSWORD = "first-password";
  const boot = issueSession(null, true);
  assert.equal(readSession(boot)?.boot, true);
  process.env.SHARED_PASSWORD = "rotated-password";
  assert.equal(readSession(boot), null);
  if (previous === undefined) delete process.env.SHARED_PASSWORD; else process.env.SHARED_PASSWORD = previous;
});

test("non-list cards may only be sent by their assigned owner; list cards follow the list", () => {
  assert.throws(() => assertCardSender("acme.test", "josh", "jenna"), /assigned to Josh/);
  assert.doesNotThrow(() => assertCardSender("acme.test", "jenna", "jenna"));
  const listRow = batchFocus()[0];
  const owner = batchOwner(listRow.domain)!;
  const other = owner === "josh" ? "jenna" : "josh";
  assert.doesNotThrow(() => assertCardSender(listRow.domain, other, owner), "the list owner sends even if assigned_to disagrees");
  assert.throws(() => assertCardSender(listRow.domain, owner, other), /Sign in as/);
});

test("the Gmail handshake cookie is sealed and records seat and user", () => {
  const cookie = oauthStateCookie({ nonce: "n1", owner: "jenna", uid: "suuchi" });
  assert.deepEqual(readOAuthStateCookie(cookie), { nonce: "n1", owner: "jenna", uid: "suuchi" });
  assert.equal(readOAuthStateCookie("n1"), null, "a bare nonce (the old format) is not accepted");
  assert.equal(readOAuthStateCookie(cookie.slice(0, -2) + "xx"), null, "tampering breaks the seal");
});
