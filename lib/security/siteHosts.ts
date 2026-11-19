// Which host serves what (owner, 2026-11-08; separate sites per plane, owner 2026-11-18):
//   insurvas.com / www.insurvas.com  the landing site (SITE_HOST)
//   app.insurvas.com                 the agent app, sign-in and sign-up (APP_HOST)
//   partner.insurvas.com             the partner portal (PARTNER_HOST, optional; unset = on APP_HOST)
//   admin.insurvas.com               the staff console (ADMIN_HOST; /admin is refused elsewhere, lib/adminAuth/adminHost.ts)
// The session cookies are pinned to their own host (AGENT_COOKIE_DOMAIN / PARTNER_COOKIE_DOMAIN), so a sign-in or
// sign-up made on the wrong host would set a cookie the browser throws away. Plain module (no `server-only`, no Next
// imports) so proxy.ts and the tests read the same rule.
//
// SITE_HOST and APP_HOST turn it on; set both or neither. Unset (local development, previews) nothing moves: every
// host serves everything, as before.
//   - An /app or /signup address on any other product host moves to APP_HOST; a /partner address moves to
//     PARTNER_HOST (or APP_HOST when that is unset). Path and query are kept, so ?plan=pro rides along.
//   - `/` on a product host opens that host's own product: app → /app, partner → /partner, admin → /admin.
//     `/` on SITE_HOST and www. stays the landing page.
//   - API routes are never moved (a redirect breaks a POST).

import { normaliseHost } from "../adminAuth/adminHost.ts";

const AGENT_ROOTS = ["/app", "/signup"] as const;
const PARTNER_ROOTS = ["/partner"] as const;

const under = (roots: readonly string[], pathname: string) => roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

/** The pages that sign in, sign up or are the product, which belong on a product host. */
export function isProductPath(pathname: string): boolean {
  return under(AGENT_ROOTS, pathname) || under(PARTNER_ROOTS, pathname);
}

/** `pathname`, when set, replaces the path (a product host's `/` opening its product); otherwise path and query are kept. */
export type HostMove = { kind: "to_app_host"; host: string; pathname?: string } | null;

/** Where this request should go instead, or null to serve it here. */
export function siteHostMove(hostname: string, pathname: string, env: Record<string, string | undefined>): HostMove {
  const site = normaliseHost(env.SITE_HOST);
  const app = normaliseHost(env.APP_HOST);
  if (!site || !app) return null;
  const partner = normaliseHost(env.PARTNER_HOST) || app;
  const admin = normaliseHost(env.ADMIN_HOST);
  const host = normaliseHost(hostname);
  const onSite = host === site || host === `www.${site}`;
  const onProductHost = host === app || host === partner || Boolean(admin && host === admin);
  if (!onSite && !onProductHost) return null;

  if (pathname === "/" && !onSite) {
    if (admin && host === admin) return { kind: "to_app_host", host, pathname: "/admin" };
    if (host === partner && partner !== app) return { kind: "to_app_host", host, pathname: "/partner" };
    if (host === app) return { kind: "to_app_host", host, pathname: "/app" };
  }
  if (under(PARTNER_ROOTS, pathname) && host !== partner) return { kind: "to_app_host", host: partner };
  if (under(AGENT_ROOTS, pathname) && host !== app) return { kind: "to_app_host", host: app };
  return null;
}
