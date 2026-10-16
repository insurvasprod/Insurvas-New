/**
 * Run `work` over `items` with at most `limit` in flight. The retention reads split a book into
 * chunks of policy numbers; firing every chunk at once on a big book is what starved the database's
 * CPU on 2026-09-30 (PGRST002), so they go a few at a time. Results keep the input order.
 */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => PromiseLike<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return out;
}

/** How many chunk reads run at once. */
export const READ_CONCURRENCY = 4;
