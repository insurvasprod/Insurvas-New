/**
 * Local testing only: with no email delivery configured, nobody could verify an address, so the
 * signup journey stopped at "Check your email". When BOTH hold —
 *
 *   - NODE_ENV is not "production" (and VERCEL_ENV is not "production"), and
 *   - ALLOW_DEV_EMAIL_LINKS=true is set explicitly —
 *
 * and email delivery is not smtp, the verification link is written to the server console instead
 * of being sent. Any production build, or a missing flag, means the normal path: nothing is logged.
 *
 * Pure (no `server-only`), so the gate itself is testable; only server code calls it.
 */
export type DevLinkEnv = Partial<Record<"NODE_ENV" | "VERCEL_ENV" | "ALLOW_DEV_EMAIL_LINKS" | "EMAIL_DELIVERY_MODE", string | undefined>>;

export function devEmailLinksEnabled(env: DevLinkEnv = process.env as DevLinkEnv): boolean {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return false;
  if (env.ALLOW_DEV_EMAIL_LINKS?.trim().toLowerCase() !== "true") return false;
  // Real delivery wins: when smtp is on, the email itself is the link.
  return env.EMAIL_DELIVERY_MODE?.trim().toLowerCase() !== "smtp";
}

/** The console line. The link is a one-time token for a local account, never a production one. */
export function devEmailLinkLine(purpose: string, to: string, url: string): string {
  return `[email:dev-link] ${purpose} for ${to}: ${url}  (ALLOW_DEV_EMAIL_LINKS, not production; nothing was sent)`;
}
