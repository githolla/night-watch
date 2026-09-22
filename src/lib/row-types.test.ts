import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every field a row type declares must be a field its query actually asks for.
 *
 * supabase-js returns loosely typed data, so a route casts it to a hand-written type. TypeScript then
 * believes that type completely — including columns the select never requested, which arrive undefined at
 * runtime with nothing to warn you. That is not hypothetical: "Rewrite every un-sent draft" declared
 * assigned_to and never selected it, so no sender profile was ever found and the tool would have stripped
 * the sender's name off every draft it touched. Typecheck, lint and two hundred tests all passed.
 *
 * This reads the source rather than running anything: for each file, every identifier mentioned in any
 * select() is collected (nested groups included, since people(full_name) does select full_name), and every
 * field of every cast row type must appear among them.
 */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) out.push(path);
  }
  return out;
}

/** Fields a row carries that no query provides: the code fills them in after the read. */
const DERIVED: Record<string, string[]> = {
  "company-team/route.ts": ["sentAt"],
};

test("no row type claims a column its query never selected", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    if (!source.includes(".select(")) continue;
    const specs = [...source.matchAll(/\.select\(\s*"([^"]+)"/g)].map((match) => match[1]);
    if (!specs.length || specs.some((spec) => spec.trim() === "*")) continue;
    // Every identifier anywhere in any select, nested groups included.
    const asked = new Set(specs.flatMap((spec) => spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []));
    const derived = new Set(Object.entries(DERIVED).find(([key]) => file.endsWith(key))?.[1] ?? []);

    for (const [, name, body] of source.matchAll(/type\s+(\w+)\s*=\s*\{([\s\S]*?)\n\};/g)) {
      // Only types the file casts a QUERY RESULT to. A file can also parse a webhook body into a type of
      // its own, and that shape has nothing to do with any select in the same file.
      const casts = [...source.matchAll(new RegExp(`as (?:unknown as )?${name}\\b`, "g"))];
      if (!casts.length) continue;
      const fromRequestBody = casts.every((cast) => /json\(\)|JSON\.parse|payload|body/i.test(source.slice(Math.max(0, cast.index - 140), cast.index)));
      if (fromRequestBody) continue;
      // Every field, not one per line: these types are written several to a line, and anchoring to the
      // start of a line found only the first — which is why this test passed with the very bug that
      // prompted it still in place.
      for (const [, field] of body.matchAll(/(\w+)\s*\??\s*:/g)) {
        if (asked.has(field) || derived.has(field)) continue;
        // Only complain about a field the code actually reads; an unused one is dead weight, not a bug.
        if (!new RegExp(`\\.${field}\\b`).test(source)) continue;
        offenders.push(`${file}: type ${name} reads .${field}, which no select() in this file asks for`);
      }
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}\n`);
});
