/**
 * One way to write a date and a period on every Reports view (QA 2026-11-03): "5 Aug – 2 Nov", the year
 * only when it differs from this year (or between the two ends), "21 Nov 2026" for a single far date.
 * Month names by hand: Node's ICU prints "Sept" where browsers print "Sep", which breaks hydration.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string) {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

/** "21 Nov", or "21 Nov 2027" when it is not this year. */
export function reportDay(iso: string | null | undefined, thisYear = new Date().getUTCFullYear()): string {
  const p = iso ? parts(iso) : null;
  if (!p) return "—";
  return `${p.d} ${MONTHS[p.m - 1]}${p.y !== thisYear ? ` ${p.y}` : ""}`;
}

/** "5 Aug – 2 Nov"; "3 Dec 2025 – 2 Nov 2026" across a year, or when not this year. */
export function reportPeriod(from: string | null | undefined, to: string | null | undefined, thisYear = new Date().getUTCFullYear()): string {
  const a = from ? parts(from) : null;
  const b = to ? parts(to) : null;
  if (!a || !b) return "—";
  const withYear = a.y !== b.y || b.y !== thisYear;
  const day = (p: { y: number; m: number; d: number }) => `${p.d} ${MONTHS[p.m - 1]}${withYear ? ` ${p.y}` : ""}`;
  return `${day(a)} – ${day(b)}`;
}
