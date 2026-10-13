import test from "node:test";
import assert from "node:assert/strict";
import { safeFetch } from "./evidence-grounding.ts";

function pdf(text: string): Uint8Array<ArrayBuffer> {
  const stream = `BT /F1 12 Tf 30 100 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = source.length;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(source);
}

test("PDF citations use the same public-host guard and expose extractable email evidence", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(pdf("Dana Ortiz dana@co.test"), { headers: { "content-type": "application/pdf" } }); };
  const page = await safeFetch("https://association.test/directory.pdf", fetcher, { pdf: true, lookup: async () => ["93.184.216.34"] });
  assert.equal(page.kind, "page");
  assert.ok(page.kind === "page" && page.html.includes("Dana Ortiz dana@co.test"));
  const refused = await safeFetch("https://private.test/directory.pdf", fetcher, { pdf: true, lookup: async () => ["127.0.0.1"] });
  assert.equal(refused.kind, "refused");
  assert.equal(calls, 1);
});
