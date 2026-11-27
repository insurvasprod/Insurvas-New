/**
 * The iOS / Android app (2026-11-24), pure rules shared by the server routes and the tests.
 *
 * The web keeps its session in an http-only cookie. The app has no cookie jar it can trust, so it holds
 * the same signed session token in the Keychain / Keystore and sends it as `Authorization: Bearer …`.
 * Every check requireTenant runs on a cookie (session row, session version, membership, suspension,
 * partner plane) runs on the header token too; the only difference is where the token is carried.
 */

/** The mark the app puts in its User-Agent, so Signed-in devices can name the session "Insurvas app on iPhone". */
export const APP_USER_AGENT_MARK = "InsurvasApp";

/** The token in an `Authorization: Bearer <token>` header, or null. Only the Bearer scheme counts. */
export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)\s*$/.exec(header);
  return match ? match[1] : null;
}
