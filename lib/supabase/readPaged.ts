/**
 * Reads every row of a query, a page at a time. PostgREST answers at most 1,000 rows per request
 * and says nothing when it stops there, so a single read of a big table is silently short (the
 * commission ledger used to stop at policy 1,000 — LA-4.7).
 *
 * `fetchPage(from, to)` asks for rows `from`..`to` inclusive of ONE query with a stable order (end
 * it with a unique column, e.g. `.order("id")`, or rows can repeat or go missing between pages).
 * Reading stops at the first short page. An error stops it too and is returned with the rows read
 * so far, so the caller decides (a schema gap may mean "retry without the new column").
 *
 * Pure and client-safe: tested in readPaged.test.mjs.
 */
export type PageResult<T> = { data: T[] | null; error: { message: string; code?: string } | null };

export const PAGE_SIZE = 1000;

export async function readPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<{ rows: T[]; error: PageResult<T>["error"] }> {
  const rows: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const page = await fetchPage(start, start + pageSize - 1);
    if (page.error) return { rows, error: page.error };
    const data = page.data ?? [];
    rows.push(...data);
    if (data.length < pageSize) return { rows, error: null };
  }
}
