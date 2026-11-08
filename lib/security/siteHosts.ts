// Which host serves the product (owner, 2026-11-08): the landing page is served on every host, but sign-in,
// sign-up and the product (the agent app and the partner portal) belong on app.insurvas.com. The session
// cookies are pinned to that host (AGENT_COOKIE_DOMAIN / PARTNER_COOKIE_DOMAIN), so a sign-in or a sign-up
// made on www.insurvas.com would set a cookie the browser throws away: the account is created and the
// person lands back on the sign-in. Plain module (no `server-only`, no Next imports) so proxy.ts and the
// tests read the same rule.
//
// SITE_HOST (`insurvas.com`) and APP_HOST (`app.insurvas.com`) turn it on. Unset (local development,
// previews) nothing changes: every host serves everything, as before.
//   - On SITE_HOST (or www. in front of it), an /app, /partner or /signup address moves to the same
//     address on APP_HOST (path and query kept, so ?plan=pro rides along), so "Sign in", "Start free
//     trial" and the pricing buttons on the landing site all land on the product's host.
//   - `/` is never moved: it is the landing page on APP_HOST too.

import { normaliseHost } from "../adminAuth/adminHost.ts";

const MOVED_ROOTS = ["/app", "/partner", "/signup"] as const;

/** The pages that sign in, sign up or are the product, which belong on APP_HOST. API routes are left alone (a redirect breaks a POST). */
export function isProductPath(pathname: string): boolean {
  return MOVED_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export type HostMove = { kind: "to_app_host"; host: string } | null;

/** Where this request should go instead, or null to serve it here. */
export function siteHostMove(hostname: string, pathname: string, env: Record<string, string | undefined>): HostMove {
  const site = normaliseHost(env.SITE_HOST);
  const app = normaliseHost(env.APP_HOST);
  if (!site || !app) return null;
  const host = normaliseHost(hostname);
  if ((host === site || host === `www.${site}`) && isProductPath(pathname)) return { kind: "to_app_host", host: app };
  return null;
}
