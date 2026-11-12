/**
 * Reading past PostgREST's page size. The API returns at most 1,000 rows a request whatever
 * `.limit()` asks for, so a list read in one request stops at 1,000 without saying so. These read
 * page by page up to a cap, and say when the cap was reached so the screen can tell the user.
 */
type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const PAGE = 1000;

/**
 * Every row `build()` selects (it must be ordered), up to `cap`. `truncated`: there were more.
 * The first page alone (most reads end there); past it, the next three at once rather than one after another
 * (perf pass 2026-11-09, as policyBookStore's `everyRow`). The same rows in the same order.
 */
export async function allRows(build: () => Loose, cap = 50_000): Promise<{ rows: Loose[]; error: Loose; truncated: boolean }> {
  const rows: Loose[] = [];
  const first = await build().range(0, PAGE - 1);
  if (first.error) return { rows, error: first.error, truncated: false };
  rows.push(...(first.data ?? []));
  if (!first.data || first.data.length < PAGE) return { rows, error: null, truncated: false };
  for (let from = PAGE; from < cap; from += 3 * PAGE) {
    const starts = [from, from + PAGE, from + 2 * PAGE].filter((at) => at < cap);
    const batch = await Promise.all(starts.map((at) => build().range(at, at + PAGE - 1)));
    for (const { data, error } of batch) {
      if (error) return { rows, error, truncated: false };
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return { rows, error: null, truncated: false };
    }
  }
  return { rows, error: null, truncated: true };
}

/** A long id list in pieces a request URL can hold. */
export const chunks = <T,>(items: T[], size = 200): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
