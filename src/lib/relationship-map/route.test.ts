import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
function handler(authenticated = true) {
  let reads = 0;
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const mocks: Record<string, unknown> = { "@/lib/relationship-map/targets": { loadTargetCompanies: async () => { reads++; return []; } }, "@/lib/relationship-map/metrics": { loadPortfolioMetrics: async () => { reads++; return { companies: {}, warnings: [] }; } }, "@/lib/relationship-map/portfolio": { loadPortfolio: async () => { reads++; return { companies: [], graph: null }; } }, "@/lib/auth": { requireUser: async () => { if (!authenticated) throw new Error("Unauthorized"); return { owner: "josh" }; } }, "@/lib/supabase/admin": { admin: () => ({}) }, "@/lib/relationship-map/load": { loadMapCompanies: async () => { reads++; return []; }, loadRelationshipGraph: async () => { reads++; return null; } } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../../app/api/network/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Response, URL, Error, require: (name: string) => mocks[name] });
  return { get: (query: string) => exports.GET!(new Request(`https://app.test/api/network${query}`)), reads: () => reads };
}
test("anonymous requests cannot read company relationships", async () => { const h = handler(false); assert.equal((await h.get("?domain=company.com")).status, 401); assert.equal(h.reads(), 0); });
test("invalid company inputs are refused before data access", async () => { const h = handler(); assert.equal((await h.get("?domain=invalid/path")).status, 400); assert.equal(h.reads(), 0); });
test("missing companies return 404 and company search stays read only", async () => { const h = handler(); assert.equal((await h.get("?domain=missing.example")).status, 404); const response = await h.get("?q=company"); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store"); });

test("all-company endpoint requires authentication and returns a fresh portfolio", async () => { const anonymous = handler(false); assert.equal((await anonymous.get("?scope=all")).status, 401); assert.equal(anonymous.reads(), 0); const h = handler(); const response = await h.get("?scope=all"); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.equal(h.reads(), 1); });

test("metrics endpoint requires authentication and reads stored aggregate data only", async () => { const anonymous = handler(false); assert.equal((await anonymous.get("?scope=metrics")).status, 401); assert.equal(anonymous.reads(), 0); const h = handler(); const response = await h.get("?scope=metrics"); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store"); });
