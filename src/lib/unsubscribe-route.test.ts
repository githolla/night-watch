import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function route(failed = false) {
  let changes = 0;
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  const mocks: Record<string, unknown> = {
    "@/lib/crypto": { decrypt: (token: string) => { if (token !== "valid") throw new Error("Invalid token"); return "person"; } },
    "@/lib/supabase/admin": { admin: () => ({}) },
    "@/lib/email-suppression": { optOutPerson: async () => { if (failed) throw new Error("Write failed"); changes++; } },
  };
  const source = readFileSync(new URL("../app/api/unsubscribe/route.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Error, URL, Response, encodeURIComponent, require: (name: string) => mocks[name] });
  return { GET: exports.GET, POST: exports.POST, changes: () => changes };
}

test("email link scanners cannot unsubscribe; a deliberate footer confirmation can", async () => {
  const h = route();
  const page = await h.GET(new Request("https://app.test/api/unsubscribe?t=valid"));
  assert.match(await page.text(), /name="confirm" value="yes"/);
  assert.equal(h.changes(), 0);
  const confirmed = await h.POST(new Request("https://app.test/api/unsubscribe?t=valid", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "confirm=yes" }));
  assert.equal(confirmed.status, 200);
  assert.match(await confirmed.text(), /You're unsubscribed/);
  assert.equal(h.changes(), 1);
});

test("mail-client one-click responses remain empty and failed writes return a retryable error", async () => {
  const request = () => new Request("https://app.test/api/unsubscribe?t=valid", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  const result = await route().POST(request());
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "");
  assert.equal((await route(true).POST(request())).status, 500);
});

test("test unsubscribe preview has no suppression or database dependencies", async () => {
  const exports: Record<string, () => Promise<Response>> = {};
  const source = readFileSync(new URL("../app/api/unsubscribe/preview/route.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Response, require: () => { throw new Error("Preview must not access suppression or the database"); } });
  assert.match(await (await exports.GET()).text(), /Unsubscribe me/);
  assert.match(await (await exports.POST()).text(), /Nobody was unsubscribed/);
});
