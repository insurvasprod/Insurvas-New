import type { TenantRole } from "./roles.ts";

/**
 * LA-8.2 (Notion sprint) · the rules of My profile & security that need no database. Plain module:
 * the routes, the page and lib/tenantAuth/security.test.mjs all read these.
 */

/**
 * The roles that can reveal an SSN, a bank account or a tax ID — and so must have two-factor
 * authentication to do it. Read off the reveal routes themselves (the test checks each one):
 *   owner      every reveal, including the agency's and payees' tax IDs
 *   producer   application fields (LA-3.7), inbound and outbound verification fields
 *   assistant  inbound verification fields — the buffer seat reads values back to the customer here
 * A setter reveals nothing (LA-2.12), so for a setter two-factor is optional. A bookkeeper reveals a
 * payee tax ID only if the agency adds them to its tax-ID viewers (LA-7.8); the reveal itself checks
 * for two-factor whoever asks, so that case is covered without making it a role rule.
 *
 * The spec names the writing agent, the tenant admin and a compliance role, and exempts buffer
 * agents "who cannot see those fields anyway". Here the assistant can, so the assistant is in.
 */
export const REVEAL_ROLES: readonly TenantRole[] = ["owner", "producer", "assistant"];

export function requiresTwoFactor(role: TenantRole): boolean {
  return REVEAL_ROLES.includes(role);
}

export const TWO_FACTOR_REQUIRED_CODE = "two_factor_required";
export const TWO_FACTOR_REQUIRED_MESSAGE = "Turn on two-factor authentication in My profile to reveal sensitive details. Everything else keeps working.";
export const TWO_FACTOR_SESSION_MESSAGE = "Sign in again with your authenticator code to reveal sensitive details: this session started before two-factor was on.";

/** Length over complexity rules: twelve characters, nothing else demanded (and nothing absurd allowed). */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Recovery codes: ten, each "XXXXX-XXXXX" from an alphabet with no look-alike characters. */
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** What a person types — any case, spaces or dashes — reduced to the form that is hashed. */
export function normaliseRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** "Chrome on Windows", "Safari on iPhone" — enough to recognise a device, from its user agent. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

/**
 * City-level location from the edge's geolocation headers, when the host provides them (Vercel sets
 * x-vercel-ip-*). Nothing is looked up from a third party, and with no headers there is no guess.
 */
export function approxLocation(headers: { get(name: string): string | null }): string | null {
  const read = (name: string) => {
    const value = headers.get(name);
    if (!value) return null;
    try { return decodeURIComponent(value).trim() || null; } catch { return value.trim() || null; }
  };
  const city = read("x-vercel-ip-city");
  const region = read("x-vercel-ip-country-region");
  const country = read("x-vercel-ip-country");
  const place = [city, region ?? (city ? country : null)].filter(Boolean).join(", ");
  return (place || country || null)?.slice(0, 120) ?? null;
}

export type FailedLogin = { ts: string; ip: string | null };

/**
 * Failed sign-ins grouped into bursts: three or more within fifteen minutes is worth showing a
 * person who wonders whether someone tried their account. A single typo is not.
 */
export function failedLoginBursts(failures: readonly FailedLogin[], windowMinutes = 15, minimum = 3): { from: string; to: string; count: number; ips: string[] }[] {
  const sorted = [...failures].sort((a, b) => a.ts.localeCompare(b.ts));
  const bursts: { from: string; to: string; count: number; ips: string[] }[] = [];
  let run: FailedLogin[] = [];
  const flush = () => {
    if (run.length >= minimum) bursts.push({ from: run[0].ts, to: run[run.length - 1].ts, count: run.length, ips: [...new Set(run.map((f) => f.ip).filter((ip): ip is string => Boolean(ip)))] });
    run = [];
  };
  for (const failure of sorted) {
    if (run.length && Date.parse(failure.ts) - Date.parse(run[run.length - 1].ts) > windowMinutes * 60_000) flush();
    run.push(failure);
  }
  flush();
  return bursts.reverse();
}

export type LoginEventRow = { id: string; ts: string; ip: string | null; user_id: string | null; email: string };

/**
 * The person's failed sign-ins, by who they are rather than by today's address: every failure the
 * login route tied to their user id, plus failures typed against an address they used to sign in
 * with that no account matched (user_id null) — the latter only up to when they moved off that
 * address, so a stranger who later takes it over is not shown here. A failure tied to someone
 * else's account is never shown, whatever its email.
 */
export function ownFailedLogins(rows: readonly LoginEventRow[], userId: string, currentEmail: string, formerEmails: ReadonlyMap<string, string>): FailedLogin[] {
  const current = currentEmail.toLowerCase();
  const seen = new Set<string>();
  const out: FailedLogin[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const email = (row.email ?? "").toLowerCase();
    const leftAt = formerEmails.get(email);
    const mine = row.user_id === userId
      || (row.user_id === null && (email === current || (leftAt !== undefined && Date.parse(row.ts) <= Date.parse(leftAt))));
    if (!mine) continue;
    seen.add(row.id);
    out.push({ ts: row.ts, ip: row.ip });
  }
  return out.sort((a, b) => b.ts.localeCompare(a.ts));
}
