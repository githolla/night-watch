import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { VOICE_BOOKING } from "./voice-booking.ts";
const require = createRequire(import.meta.url);
function route(options: { duplicate?: boolean; stillLinked?: boolean } = {}) {
  let messages = 0, reservations = 0;
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/cron/shutdown/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Response,
    require: (name: string) => {
      if (name === "@/lib/auth") return { cronAuthorized: (request: Request) => request.headers.get("authorization") === "Bearer test" };
      if (name === "@/lib/voice-booking") return { VOICE_BOOKING };
      if (name === "@/lib/vapi") return { vapiRequest: async (path: string, method?: string) => path === "/phone-number" ? [{ id: "phone", number: VOICE_BOOKING.callerNumber }] : method === "PATCH" ? {} : { assistantId: options.stillLinked ? "agent" : null, squadId: null } };
      if (name === "@/lib/slack") return { postSlackMessage: async (text: string) => { messages++; assert.match(text, /turned off completely/); return true; } };
      if (name === "@/lib/supabase/admin") return { admin: () => ({ from: () => ({ insert: async () => { reservations++; return { error: options.duplicate ? { code: "23505" } : null }; } }) }) };
      return require(name);
    },
  });
  return { post: exports.POST as (request: Request) => Promise<Response>, metrics: () => ({ messages, reservations }) };
}
const request = (announce: boolean, authorized = true) => new Request("https://example.com/api/cron/shutdown", { method: "POST", headers: { authorization: authorized ? "Bearer test" : "wrong", "content-type": "application/json" }, body: JSON.stringify({ announce }) });
test("only an explicitly requested authenticated shutdown announcement posts", async () => {
  const h = route();
  assert.equal((await h.post(request(true, false))).status, 401);
  assert.equal((await h.post(request(false))).status, 200);
  assert.equal(h.metrics().messages, 0);
  assert.equal((await h.post(request(true))).status, 200);
  assert.equal(h.metrics().messages, 1);
});
test("shutdown announcement cannot be duplicated or claim a linked agent is off", async () => {
  const duplicate = route({ duplicate: true });
  await duplicate.post(request(true));
  assert.equal(duplicate.metrics().messages, 0);
  const linked = route({ stillLinked: true });
  assert.equal((await linked.post(request(true))).status, 503);
  assert.equal(linked.metrics().reservations, 0);
});
