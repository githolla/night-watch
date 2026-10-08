import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { seatOwner } from "./types.ts";

const require = createRequire(import.meta.url);
type Calls = { imports: unknown[]; evidence: unknown[] };

function route(authorized: boolean) {
  const calls: Calls = { imports: [], evidence: [] };
  const source = readFileSync(new URL("../app/api/lists/import/route.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mocks: Record<string, unknown> = {
    zod: require("zod"),
    "@/lib/auth": { listImportAuthorized: () => authorized },
    "@/lib/list-sectors": { REVENUE_BAND_USD_M: { min: 10, max: 50 }, SECTORS: ["roofing"] },
    "@/lib/nightly-list-builder": {
      nightlyListConfig: () => ({ size: 12, minFit: 40 }),
      screenDomains: async (_db: unknown, domains: string[]) => domains.map((domain) => ({ domain, usable: true, reason: null })),
      importResearchedList: async (_db: unknown, input: unknown) => { calls.imports.push(input); return { status: "ready", listed: [], reserved: [], skipped: [], addresses: [] }; },
      addressesToWork: async () => [],
      importAddressEvidence: async (_db: unknown, items: unknown[]) => { calls.evidence.push(...items); return []; },
    },
    "@/lib/nightly-research": { researchPrompt: () => "Research <company>" },
    "@/lib/supabase/admin": { admin: () => ({}) },
    "@/lib/types": { seatOwner },
  };
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(output, { exports, Error, Response, URL, process: { env: {} }, require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked ${name}`); } });
  const post = (body: unknown) => exports.POST(new Request("https://test/api/lists/import", { method: "POST", body: JSON.stringify(body) }));
  return { post, calls };
}

test("without the list import secret nothing runs", async () => {
  const { post, calls } = route(false);
  const response = await post({ action: "import", listDate: "2026-10-12", owner: "suuchi", companies: [{ company: "Acme", domain: "acme.com", research: {} }] });
  assert.equal(response.status, 401);
  assert.equal(calls.imports.length, 0);
});

test("brief returns the band, sectors and the app's own research prompt", async () => {
  const body = await (await route(true).post({ action: "brief", listDate: "2026-10-12" })).json();
  assert.deepEqual(body.revenueBandUsdM, { min: 10, max: 50 });
  assert.equal(body.listSize, 12);
  assert.match(body.researchPrompt, /Research/);
});

test("import needs a real seat and a date, and passes validated companies through", async () => {
  const { post, calls } = route(true);
  assert.equal((await post({ action: "import", listDate: "2026-10-12", owner: "nobody", companies: [{ company: "Acme", domain: "acme.com", research: {} }] })).status, 400);
  assert.equal((await post({ action: "import", listDate: "Monday", owner: "suuchi", companies: [{ company: "Acme", domain: "acme.com", research: {} }] })).status, 400);
  assert.equal(calls.imports.length, 0);
  const ok = await post({ action: "import", listDate: "2026-10-12", owner: "suuchi", companies: [{ company: "Acme", domain: "acme.com", research: {}, emailEvidence: { kind: "published", address: "jo@acme.com", sourceUrl: "https://acme.com/team" } }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.imports[0])), { listDate: "2026-10-12", owner: "suuchi", companies: [{ company: "Acme", domain: "acme.com", research: {}, emailEvidence: { kind: "published", address: "jo@acme.com", sourceUrl: "https://acme.com/team" } }] });
});

test("address evidence must be a published page or a proven format", async () => {
  const { post, calls } = route(true);
  assert.equal((await post({ action: "addresses-import", items: [{ personId: "p", domain: "acme.com", name: "Jo", emailEvidence: { kind: "guess", address: "jo@acme.com" } }] })).status, 400);
  assert.equal(calls.evidence.length, 0);
  assert.equal((await post({ action: "addresses-import", items: [{ personId: "p", domain: "acme.com", name: "Jo", emailEvidence: { kind: "published", address: "jo@acme.com", sourceUrl: "https://acme.com/team" } }] })).status, 200);
  assert.equal(calls.evidence.length, 1);
});
