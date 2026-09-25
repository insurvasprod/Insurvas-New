// Display helpers for the admin tenant record. Plain module: server tabs and client islands share it.

// Month names by hand, not Intl: ICU builds disagree ("Sep" in one, "Sept" in another), so a server
// and a browser with different ICU data printed different text and the client island failed to
// hydrate. getUTC* parts keep the day the same everywhere.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const day = (date: Date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
const pad = (n: number) => String(n).padStart(2, "0");

/** "4 Mar 2025" — the boards' date. UTC, so the server and the browser print the same day. */
export function recordDate(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? day(date) : "—";
}

/** "4 Mar" — a day inside a range whose year is shown once ("4 Mar – 3 Apr 2025"). */
export function recordDayMonth(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` : "—";
}

/** "4 Mar 2025, 14:05 UTC" — for audit rows, where the time matters. */
export function recordDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? `${day(date)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC` : "—";
}

/** "provisioning" -> "Provisioning", "past_due" -> "Past due". */
export function sentenceCase(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
