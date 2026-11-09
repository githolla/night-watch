import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function gate(pathname: string) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../proxy.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL,
    require: (name: string) => {
      if (name === "@/lib/shared-auth") return { SESSION_COOKIE: "session" };
      if (name === "@/lib/session") return { readSession: () => null };
      if (name === "next/server") return { NextResponse: class extends Response { static next() { return new Response("allowed"); } } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return (exports.proxy as (request: unknown) => Response)({ nextUrl: { pathname }, url: `https://example.com${pathname}`, cookies: { get: () => undefined } });
}

test("shutdown blocks cron, manual outreach, Slack, voice hooks and the website", async () => {
  for (const path of ["/", "/calls", "/api/cron/voice-pilot", "/api/cron/cadences", "/api/slack/commands", "/api/voice/vapi", "/api/lists/import"]) {
    const response = gate(path);
    assert.equal(response.status, 503, path);
    assert.match(await response.text(), /turned off/);
  }
});
test("shutdown preserves unsubscribe handling and the authenticated provider shutdown endpoint", () => {
  assert.equal(gate("/api/unsubscribe").status, 200);
  assert.equal(gate("/api/cron/shutdown").status, 200);
});
test("no scheduled jobs remain configured", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: unknown[] };
  assert.deepEqual(config.crons, []);
});
