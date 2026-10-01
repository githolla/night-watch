/**
 * Supabase caps one request at 1,000 rows and truncates silently past it.
 * With 1,859 companies that is a real bug, not a corner case: page.
 *
 * Pages after the first are requested a few at a time instead of one after another: 5,490 people took six
 * round trips in a row and now take three. Rows come back in page order, so an .order() in `build` holds.
 */
type Page<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<Page<T>>, pageSize = 1000, max = 50_000, parallel = 4): Promise<T[]> {
  const rows: T[] = [];
  const first = await build(0, pageSize - 1);
  if (first.error) throw new Error(first.error.message);
  rows.push(...(first.data ?? []));
  if ((first.data?.length ?? 0) < pageSize) return rows;
  for (let from = pageSize; from < max; from += pageSize * parallel) {
    const starts = Array.from({ length: parallel }, (_, index) => from + index * pageSize).filter((start) => start < max);
    const pages = await Promise.all(starts.map((start) => build(start, start + pageSize - 1)));
    for (const page of pages) {
      if (page.error) throw new Error(page.error.message);
      rows.push(...(page.data ?? []));
      if ((page.data?.length ?? 0) < pageSize) return rows;
    }
  }
  return rows;
}
