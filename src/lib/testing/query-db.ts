import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string; message: string } | null; count?: number };
type Rpc = (args: Record<string, unknown>, tables: Record<string, Row[]>) => unknown;

const read = (row: Row, path: string): unknown => path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Row)[key] : undefined), row);
const pattern = (like: string, flags: string) => new RegExp(`^${like.replace(/\\([\\%_])|([.*+?^${}()|[\]\\])|(%)|(_)/g, (_m, escaped, special, percent, under) => escaped ? `\\${escaped}` : special ? `\\${special}` : percent ? ".*" : under ? "." : "")}$`, flags);

/**
 * An in-memory stand-in for the Supabase query builder, a little richer than memory-db: range filters,
 * like/ilike, ordering, dotted paths into embedded rows (seed them nested), conditional updates that
 * return the rows they changed, rpc handlers and injected failures.
 */
export function queryDb(seed: Record<string, Row[]> = {}, rpcs: Record<string, Rpc> = {}) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const failures: Array<{ table: string; op: string }> = [];
  const log: Array<{ table: string; op: string; payload?: unknown }> = [];
  let tick = 0;
  function from(table: string) {
    let op = "select", payload: Row | Row[] = {}, single = false, head = false, count = false, ignore = false, max = Infinity, offset = 0, conflict: string[] = [];
    const filters: Array<(row: Row) => boolean> = [];
    const order: Array<{ key: string; ascending: boolean }> = [];
    const q = {
      select(_columns?: string, opts?: { head?: boolean; count?: string }) { if (opts?.head) head = true; if (opts?.count) count = true; return q; },
      insert(value: Row | Row[]) { op = "insert"; payload = value; return q; },
      upsert(value: Row | Row[], opts?: { ignoreDuplicates?: boolean; onConflict?: string }) { op = "insert"; payload = value; ignore = Boolean(opts?.ignoreDuplicates); conflict = opts?.onConflict?.split(",").map((key) => key.trim()) ?? []; return q; },
      update(value: Row) { op = "update"; payload = value; return q; },
      delete() { op = "delete"; return q; },
      eq(key: string, value: unknown) { filters.push((row) => read(row, key) === value); return q; },
      neq(key: string, value: unknown) { filters.push((row) => read(row, key) !== value); return q; },
      in(key: string, values: unknown[]) { filters.push((row) => values.includes(read(row, key))); return q; },
      is(key: string, value: unknown) { filters.push((row) => (read(row, key) ?? null) === value); return q; },
      not(key: string, operator: string, value: unknown) { filters.push((row) => (operator === "is" ? (read(row, key) ?? null) !== value : read(row, key) !== value)); return q; },
      gte(key: string, value: string | number) { filters.push((row) => read(row, key) != null && String(read(row, key)) >= String(value)); return q; },
      gt(key: string, value: string | number) { filters.push((row) => read(row, key) != null && String(read(row, key)) > String(value)); return q; },
      lte(key: string, value: string | number) { filters.push((row) => read(row, key) != null && String(read(row, key)) <= String(value)); return q; },
      lt(key: string, value: string | number) { filters.push((row) => read(row, key) != null && String(read(row, key)) < String(value)); return q; },
      like(key: string, value: string) { filters.push((row) => pattern(value, "").test(String(read(row, key) ?? ""))); return q; },
      ilike(key: string, value: string) { filters.push((row) => pattern(value, "i").test(String(read(row, key) ?? ""))); return q; },
      // PostgREST's or(): comma-separated "column.op.value" terms, for the ops the code uses (is, eq, in, not.in).
      or(expression: string) {
        const terms = expression.split(/,(?![^(]*\))/).map((term) => {
          const [key, ...rest] = term.split(".");
          const negate = rest[0] === "not";
          const [op, ...valueParts] = negate ? rest.slice(1) : rest;
          const raw = valueParts.join(".");
          const test = (row: Row) => {
            const value = read(row, key);
            if (op === "is") return (value ?? null) === (raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : raw);
            if (op === "eq") return String(value) === raw;
            if (op === "in") return raw.replace(/^\(|\)$/g, "").split(",").includes(String(value));
            throw new Error(`queryDb or(): unsupported operator ${op}`);
          };
          return negate ? (row: Row) => !test(row) : test;
        });
        filters.push((row) => terms.some((test) => test(row)));
        return q;
      },
      order(key: string, opts?: { ascending?: boolean }) { order.push({ key, ascending: opts?.ascending !== false }); return q; },
      limit(n: number) { max = n; return q; },
      range(fromIndex: number, toIndex: number) { offset = fromIndex; max = toIndex - fromIndex + 1; return q; },
      single() { single = true; return q; },
      maybeSingle() { single = true; return q; },
      then(resolve: (result: Result) => unknown, reject?: (error: unknown) => unknown) {
        try {
          log.push({ table, op, payload });
          const failed = failures.findIndex((item) => item.table === table && item.op === op);
          if (failed >= 0) { failures.splice(failed, 1); return Promise.resolve(resolve({ data: null, error: { code: "FAIL", message: "Injected failure" } })); }
          const rows = tables[table] ?? (tables[table] = []);
          let result = rows.filter((row) => filters.every((fn) => fn(row)));
          for (const { key, ascending } of [...order].reverse()) result = [...result].sort((a, b) => (String(read(a, key)) < String(read(b, key)) ? -1 : String(read(a, key)) > String(read(b, key)) ? 1 : 0) * (ascending ? 1 : -1));
          result = result.slice(offset, offset + max);
          if (op === "insert") {
            result = [];
            for (const value of Array.isArray(payload) ? payload : [payload]) {
              const keys = conflict.length ? conflict : ["id"];
              const duplicate = rows.some((row) => keys.every((key) => value[key] !== undefined && row[key] === value[key]));
              if (duplicate) { if (ignore) continue; return Promise.resolve(resolve({ data: null, error: { code: "23505", message: "Duplicate" } })); }
              const row = { id: `row-${++tick}`, ...value };
              rows.push(row);
              result.push(row);
            }
          } else if (op === "update") {
            for (const row of result) Object.assign(row, payload);
          } else if (op === "delete") {
            tables[table] = rows.filter((row) => !result.includes(row));
          }
          const data = head ? null : structuredClone(single ? result[0] ?? null : result);
          return Promise.resolve(resolve({ data, error: null, ...(count ? { count: result.length } : {}) }));
        } catch (error) {
          return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
        }
      },
    };
    return q;
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const handler = rpcs[name];
    if (!handler) return { data: null, error: { code: "PGRST202", message: `No function ${name}` } };
    return { data: handler(args, tables), error: null };
  }
  return { db: { from, rpc } as unknown as SupabaseClient, tables, log, fail: (table: string, op: string) => failures.push({ table, op }) };
}
