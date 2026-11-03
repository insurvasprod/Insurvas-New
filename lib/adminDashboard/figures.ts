// The staff dashboard's arithmetic (p-adm-home). Plain module: no database, no `server-only`, so the
// rules below are testable on their own and the page and its tests read the same code.

import type { AdminRole } from "@/lib/adminAuth/roles";

/**
 * The chip order on "Admins by role": the board's three, then the role it does not draw. Fixed, so
 * the chips do not reshuffle with whatever order the database returned the rows in.
 */
export const ADMIN_ROLE_CHIP_ORDER: readonly AdminRole[] = ["super_admin", "billing_admin", "support_agent", "platform_config"];

/** Active admins per role, in chip order, leaving out roles nobody active holds. */
export function activeAdminsByRole(rows: { role: AdminRole; is_active: boolean }[]): { role: AdminRole; count: number }[] {
  const counts = new Map<AdminRole, number>();
  for (const row of rows) {
    if (row.is_active) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
  }
  return ADMIN_ROLE_CHIP_ORDER.filter((role) => (counts.get(role) ?? 0) > 0).map((role) => ({ role, count: counts.get(role)! }));
}

/**
 * Monday 00:00 UTC of the week containing `now` — the same boundary as Postgres
 * `date_trunc('week', now())` in a UTC database, which the login stats already use for "this week".
 */
export function startOfUtcWeek(now: number): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day;
}

export type LockoutRow = { bucket_key: string; hits: number; window_start: string };

/**
 * How many distinct email addresses are locked out of signing in right now.
 *
 * A lockout is kept per email AND IP (`login_lockout:login:<actor>:<email>:<ip>`, written by
 * lib/authProtection), so one person failing from two networks holds two rows. Counting rows would
 * call that two people. A row is an ACTIVE lockout by the rule sign-in itself applies
 * (lib/authProtection checkLoginAllowed) and the Advanced page's lockout list shows
 * (app/api/admin/security/rate-limits): at least `threshold` failures, and the lockout window since
 * the first of them has not run out.
 */
export function activeLockoutEmails(rows: LockoutRow[], threshold: number, lockoutMinutes: number, now: number): number {
  const emails = new Set<string>();
  for (const row of rows) {
    if (row.hits < threshold) continue;
    const expiresAt = new Date(row.window_start).getTime() + lockoutMinutes * 60_000;
    if (!(expiresAt > now)) continue;
    const parts = row.bucket_key.split(":");
    if (parts[0] !== "login_lockout" || parts[1] !== "login") continue;
    let email: string;
    try {
      email = decodeURIComponent(parts[3] ?? "").toLowerCase();
    } catch {
      email = (parts[3] ?? "").toLowerCase();
    }
    if (email) emails.add(email);
  }
  return emails.size;
}

// Spelled out rather than taken from Intl: newer ICU prints en-GB September as "Sept", and the
// server and the browser can carry different ICU versions.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** "22 Sep 2026 08:40:55 UTC". Always UTC, so the server and the browser print the same text. */
export function formatUtcDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** "1 thing" / "3 things". */
export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}
