// Admin dashboard › Security & staff (admin round 1, docs/design/admin-r1/dashboard-combined.html §6): the
// arithmetic, with no database, so it is testable. securityQueries.ts reads the rows.

/** Signing in and out is the sign-in graph's business, not a change a staff member made. */
export const STAFF_SIGN_IN_ACTIONS = ["admin.login", "admin.logout"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type SignInDay = { key: string; label: string; succeeded: number; failed: number };

/** The last `days` UTC days ending today, oldest first, each with its sign-ins counted. */
export function signInDays(events: ReadonlyArray<{ at: string; success: boolean }>, now: number, days: number): SignInDay[] {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const out: SignInDay[] = [];
  const index = new Map<string, SignInDay>();
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(today.getTime() - back * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    const entry = { key, label: back === 0 ? "Today" : `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`, succeeded: 0, failed: 0 };
    out.push(entry);
    index.set(key, entry);
  }
  for (const event of events) {
    const entry = index.get(event.at.slice(0, 10));
    if (!entry) continue;
    if (event.success) entry.succeeded += 1;
    else entry.failed += 1;
  }
  return out;
}

/** "Quinn Testmore" → "QT", "qa.design@insurvas.test" → "QD": a staff member's initials for the avatar. */
export function initials(nameOrEmail: string | null | undefined): string {
  const text = (nameOrEmail ?? "").trim();
  if (!text) return "?";
  const base = text.includes("@") ? text.split("@")[0] : text;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0][0]}${words[1][0]}` : base.slice(0, 2);
  return letters.toUpperCase();
}

/** "14:05", the UTC time of a change today. */
export function utcClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}
