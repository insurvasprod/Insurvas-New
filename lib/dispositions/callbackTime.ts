/**
 * A wall-clock time in a timezone, as the instant it names. Plain module, no aliases, so a
 * `node --test` file can check the DST edges.
 *
 * A callback is booked as `YYYY-MM-DDTHH:MM` in the CUSTOMER's zone (the wizard and the dialer both
 * send it that way, and the booking functions convert it in SQL). Checking it against the calling
 * window needs the same instant here, so it is resolved with Intl — which knows each zone's rules
 * for that date — rather than with a fixed offset.
 */

function offsetMs(at: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return asUtc - at.getTime();
}

/**
 * `2026-10-01T14:30` in `America/Phoenix` → the Date for that moment. Null when the text is not
 * that shape or the zone is unknown. A time that does not exist (inside a spring-forward gap)
 * resolves to the instant an hour later, as Postgres does.
 */
export function zonedLocalToUtc(local: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  try {
    let guess = wall - offsetMs(new Date(wall), timezone);
    // Once more at the guess, in case a DST change sits between the wall time and the instant.
    guess = wall - offsetMs(new Date(guess), timezone);
    return new Date(guess);
  } catch {
    return null;
  }
}
