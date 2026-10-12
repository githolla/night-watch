import assert from "node:assert/strict";
import test from "node:test";
import { addLogos } from "./email-logos.ts";

const png = (width: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, width);
  return bytes;
};

test("emails only use a logo that was found and is sharp; the rest get initials", async () => {
  const answers: Record<string, Response> = {
    "real-logo.com": new Response(png(64), { status: 200, headers: { "content-type": "image/png" } }),
    "no-logo.com": new Response(png(16), { status: 404, headers: { "content-type": "image/png" } }),
    "tiny-logo.com": new Response(png(16), { status: 200, headers: { "content-type": "image/png" } }),
  };
  const asked: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const domain = new URL(String(input)).searchParams.get("domain") ?? "";
    asked.push(domain);
    if (domain === "down.com") throw new Error("network");
    return answers[domain];
  }) as typeof fetch;
  const rows: Array<{ domain: string; logo?: string | null }> = [{ domain: "real-logo.com" }, { domain: "real-logo.com" }, { domain: "no-logo.com" }, { domain: "tiny-logo.com" }, { domain: "down.com" }, { domain: "" }];
  await addLogos(rows, fetcher);
  assert.equal(rows[0].logo, "https://www.google.com/s2/favicons?domain=real-logo.com&sz=64");
  assert.equal(rows[1].logo, rows[0].logo);
  assert.deepEqual(rows.slice(2).map((row) => row.logo), [null, null, null, null]);
  assert.equal(asked.filter((domain) => domain === "real-logo.com").length, 1, "each company is looked up once");
});
