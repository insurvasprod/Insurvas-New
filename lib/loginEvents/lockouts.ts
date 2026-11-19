// Monitoring › Lockouts (admin round 1, docs/design/admin-r1/monitoring.html screen 3): one sign-in lockout row
// read from the rate-limit store, in words. Plain module (no `server-only`, no imports) so the page, the workspace
// and the tests share it. The keys are `login_lockout:login:<plane>:<email>:<ip>` (lib/authProtection/factor.ts),
// where the plane is the actor type, or `<actor>_2fa` for the staff authenticator-code step.

export type LockoutPlane = "user" | "admin" | "admin_2fa" | "partner" | "other";

export type LockoutEntry = {
  scopeKey: string;
  plane: LockoutPlane;
  email: string;
  ip: string;
  failures: number;
  /** When the counting window began: the first failure the lockout counts. */
  since: string;
  /** When the lock lifts; null while the failures are under the threshold (counted, not locked). */
  unlocksAt: string | null;
};

/** Wrong authenticator codes before the staff two-step lockout applies (lib/authProtection/factor.ts TOTP_LOCKOUT_MAX). */
const TOTP_LOCKOUT_MAX = 5;

export const LOCKOUT_PLANE_LABEL: Record<LockoutPlane, string> = {
  user: "Customer",
  admin: "Staff",
  admin_2fa: "Staff · two-step code",
  partner: "Partner",
  other: "Other",
};

function decode(part: string | undefined): string {
  if (!part) return "unknown";
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/**
 * One rate_limits row as a lockout. The same arithmetic sign-in applies (lockoutRetrySeconds): the key is locked
 * when its hits reach the threshold and the window has not run out. Null for a key that is not a sign-in lockout.
 */
export function lockoutEntry(
  row: { bucket_key: string; hits: number; window_start: string },
  config: { threshold: number; minutes: number; now: number },
): LockoutEntry | null {
  const parts = row.bucket_key.split(":");
  if (parts[0] !== "login_lockout" || parts[1] !== "login") return null;
  const raw = parts[2] ?? "";
  const plane: LockoutPlane = raw === "user" || raw === "admin" || raw === "admin_2fa" || raw === "partner" ? raw : "other";
  const threshold = plane === "admin_2fa" ? Math.min(TOTP_LOCKOUT_MAX, config.threshold) : config.threshold;
  const lifts = Date.parse(row.window_start) + config.minutes * 60_000;
  const locked = row.hits >= threshold && lifts > config.now;
  return {
    scopeKey: row.bucket_key,
    plane,
    email: decode(parts[3]),
    ip: decode(parts.slice(4).join(":") || undefined),
    failures: row.hits,
    since: row.window_start,
    unlocksAt: locked ? new Date(lifts).toISOString() : null,
  };
}

/** Locked first (soonest to lift first), then the counted-but-not-locked keys, newest first. */
export function sortLockouts(entries: readonly LockoutEntry[]): LockoutEntry[] {
  return [...entries].sort((a, b) => {
    if (Boolean(a.unlocksAt) !== Boolean(b.unlocksAt)) return a.unlocksAt ? -1 : 1;
    if (a.unlocksAt && b.unlocksAt) return a.unlocksAt.localeCompare(b.unlocksAt);
    return b.since.localeCompare(a.since);
  });
}

/** Distinct email addresses locked right now: the figure the dashboard and the rail count. */
export function lockedAccounts(entries: readonly LockoutEntry[]): number {
  return new Set(entries.filter((entry) => entry.unlocksAt).map((entry) => entry.email.toLowerCase())).size;
}
