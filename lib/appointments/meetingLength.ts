/**
 * How long one meeting takes, chosen per appointment (owner, 2026-11-13: "edit how long I want this
 * meeting to take, individually, not in the settings"). Settings › Booking rules keeps the default
 * length; a booking or an existing meeting can take any of these instead. Bounded like the table's
 * check, 5 minutes to 8 hours. No server imports: the calendar screen and the route share it.
 */

export const MIN_MEETING_MINUTES = 5;
export const MAX_MEETING_MINUTES = 480;
const COMMON = [15, 30, 45, 60, 90, 120, 180] as const;

/** The lengths to offer: the common ones, plus the default and the current length when they are not among them. */
export function lengthOptions(...also: Array<number | null | undefined>): number[] {
  const extra = also.filter((value): value is number => typeof value === "number" && value >= MIN_MEETING_MINUTES && value <= MAX_MEETING_MINUTES);
  return [...new Set([...COMMON, ...extra])].sort((a, b) => a - b);
}

/** "15 min", "1 hr", "1 hr 30 min". */
export function lengthLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}
