/**
 * LA-6.3 · a report's date range from the query string: YYYY-MM-DD days, `to` inclusive. Pure.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string): Date | null {
  if (!DAY.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

export function evidenceRange(from: string | null, to: string | null): { from: string | null; to: string | null } | { error: string } {
  const f = from ? day(from) : null;
  const t = to ? day(to) : null;
  if (from && !f) return { error: "From must be a date (YYYY-MM-DD)." };
  if (to && !t) return { error: "To must be a date (YYYY-MM-DD)." };
  if (f && t && f > t) return { error: "From must be on or before To." };
  // `to` is the whole day: the range ends at the next midnight.
  return { from: f ? f.toISOString() : null, to: t ? new Date(t.getTime() + 86_400_000).toISOString() : null };
}
