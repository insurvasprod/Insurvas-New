/**
 * "Last seen" on Settings › Team & access. Plain module: the team screen and the presence writer
 * share it, and the client may import it.
 */
import { dayMonth } from "../format/dates.ts";

/** One presence write per member per minute per server. */
export const PRESENCE_WRITE_INTERVAL_MS = 60_000;
/** Seen inside this window reads "Now": the alert feed polls every few seconds, and a write lands at most once a minute. */
export const PRESENCE_NOW_WINDOW_MS = 2 * 60_000;

export function shouldTouchPresence(lastWriteAt: number | undefined, now: number): boolean {
  return lastWriteAt === undefined || now - lastWriteAt >= PRESENCE_WRITE_INTERVAL_MS;
}

/** The newest of several activity stamps (activity poll, Agent Floor heartbeat). Null when none. */
export function newestStamp(...stamps: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestAt = -Infinity;
  for (const stamp of stamps) {
    if (!stamp) continue;
    const at = new Date(stamp).getTime();
    if (Number.isFinite(at) && at > bestAt) {
      best = stamp;
      bestAt = at;
    }
  }
  return best;
}

/**
 * "Now", "4 min ago", "1 hr ago", "3 days ago", then a date ("9 Sep") — the board's wording. The date
 * reads in `zone`: UTC unless a mounted client passes the viewer's own.
 */
export function relativeSeen(value: string, now: number, zone = "UTC"): string {
  const elapsed = now - new Date(value).getTime();
  if (elapsed < PRESENCE_NOW_WINDOW_MS) return "Now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return dayMonth(value, zone);
}

/**
 * The cell text. Presence when it is recorded; otherwise the last sign-in, said as a sign-in so it
 * is never mistaken for presence (the case until migration 20260924220400 is applied).
 */
export function lastSeenCell(member: { lastSeenAt?: string | null; lastLoginAt?: string | null }, now: number, zone = "UTC"): string {
  if (member.lastSeenAt) return relativeSeen(member.lastSeenAt, now, zone);
  if (member.lastLoginAt) {
    const label = relativeSeen(member.lastLoginAt, now, zone);
    return label === "Now" ? "Signed in just now" : `Signed in ${label}`;
  }
  return "Never signed in";
}
