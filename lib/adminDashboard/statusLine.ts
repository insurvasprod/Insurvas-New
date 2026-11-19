// shortDay, shared by the dashboard's Needs you rows (needsRows.ts). The dashboard's status line under the
// title was removed (owner 2026-11-18: no text over the cards); only this date helper remains.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-21" → "Sep 21" (the board's form); anything else as it came. */
export function shortDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  return `${MONTHS[Number(match[2]) - 1] ?? match[2]} ${Number(match[3])}`;
}
