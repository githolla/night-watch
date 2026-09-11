/**
 * Supabase caps one request at 1,000 rows and truncates silently past it.
 * With 1,859 companies that is a real bug, not a corner case: page.
 */
type Page<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<Page<T>>, pageSize = 1000, max = 50_000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return rows;
}
