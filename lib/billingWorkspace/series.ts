// The billing workspace's trend lines, kept pure so the bucketing is tested on its own (series.test.mjs).
// UTC throughout, so the server render and the browser agree.

export type Bucket = { key: string; start: string; end: string };

const DAY_MS = 86_400_000;

/** The last `count` calendar months (UTC), oldest first; the last is the current month, still running. */
export function monthBuckets(now: number, count: number): Bucket[] {
  const today = new Date(now);
  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset + 1, 1));
    return { key: start.toISOString().slice(0, 7), start: start.toISOString(), end: end.toISOString() };
  });
}

/** The last `count` seven-day windows ending now, oldest first. */
export function weekBuckets(now: number, count: number): Bucket[] {
  return Array.from({ length: count }, (_, index) => {
    const end = now - (count - 1 - index) * 7 * DAY_MS;
    return { key: String(index), start: new Date(end - 7 * DAY_MS).toISOString(), end: new Date(end).toISOString() };
  });
}

function inBucket(at: string, bucket: Bucket): boolean {
  const ms = Date.parse(at);
  return ms >= Date.parse(bucket.start) && ms < Date.parse(bucket.end);
}

/** How many of `dates` fall in each bucket. */
export function bucketCounts(dates: readonly string[], buckets: readonly Bucket[]): number[] {
  return buckets.map((bucket) => dates.filter((at) => inBucket(at, bucket)).length);
}

/** The sum of `value` for the rows in each bucket. */
export function bucketSums(rows: readonly { at: string; value: number }[], buckets: readonly Bucket[]): number[] {
  return buckets.map((bucket) => rows.filter((row) => inBucket(row.at, bucket)).reduce((sum, row) => sum + row.value, 0));
}

/**
 * How many invoices were overdue at `atIso`: past their due date then, and not yet paid or voided by then.
 * Drafts never fall due. An invoice with no due date is never overdue.
 */
export function overdueAt(invoices: readonly { status: string; due_at: string | null; paid_at: string | null; voided_at: string | null }[], atIso: string): number {
  const at = Date.parse(atIso);
  return invoices.filter((row) => {
    if (row.status === "draft" || !row.due_at) return false;
    if (Date.parse(row.due_at) >= at) return false;
    if (row.paid_at && Date.parse(row.paid_at) <= at) return false;
    if (row.voided_at && Date.parse(row.voided_at) <= at) return false;
    if (row.status === "void" && !row.voided_at) return false;
    return true;
  }).length;
}
