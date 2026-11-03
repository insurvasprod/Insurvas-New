/**
 * Reading past PostgREST's page size. The API returns at most 1,000 rows a request whatever
 * `.limit()` asks for, so a list read in one request stops at 1,000 without saying so. These read
 * page by page up to a cap, and say when the cap was reached so the screen can tell the user.
 */
type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const PAGE = 1000;

/** Every row `build()` selects (it must be ordered), up to `cap`. `truncated`: there were more. */
export async function allRows(build: () => Loose, cap = 50_000): Promise<{ rows: Loose[]; error: Loose; truncated: boolean }> {
  const rows: Loose[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { rows, error, truncated: false };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}

/** A long id list in pieces a request URL can hold. */
export const chunks = <T,>(items: T[], size = 200): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
