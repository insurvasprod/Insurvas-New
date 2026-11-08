// Which host serves the product (owner, 2026-11-08): the landing page is served on every host, but sign-in
// and the product (the agent app and the partner portal) belong on app.insurvas.com. The session cookies
// are pinned to that host (AGENT_COOKIE_DOMAIN / PARTNER_COOKIE_DOMAIN), so a sign-in made on
// www.insurvas.com would set a cookie the browser throws away and look as if it did nothing. Plain module
// (no `server-only`, no Next imports) so proxy.ts and the tests read the same rule.
//
// SITE_HOST (`insurvas.com`) and APP_HOST (`app.insurvas.com`) turn it on. Unset (local development,
// previews) nothing changes: every host serves everything, as before.
//   - On SITE_HOST (or www. in front of it), an /app or /partner address moves to the same address on
//     APP_HOST, so a "Sign in" link on the landing page lands on the product's host.
//   - `/` is never moved: it is the landing page on APP_HOST too.

import { normaliseHost } from "../adminAuth/adminHost.ts";

/** The product's own pages, which belong on APP_HOST. API routes are left alone (a redirect breaks a POST). */
export function isProductPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/") || pathname === "/partner" || pathname.startsWith("/partner/");
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
