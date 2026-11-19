// Which host may serve the admin plane. Plain module (no `server-only`, no Next imports) so proxy.ts
// and the tests read the same rule.
//
// ADMIN_HOST (e.g. `admin.insurvas.com`) names the one host that serves /admin and /api/admin. When
// it is set, any other host — the agent app's `app.insurvas.com` above all — answers those paths
// with a plain 404, so the staff console and its cookies never live on the customer-facing origin.
// Unset (local development, previews) nothing changes: every host serves /admin as before.

/** Lower-cased host with any port and trailing dot removed; empty when unset. */
export function normaliseHost(value: string | null | undefined): string {
  return (value ?? "").split(",")[0].trim().split(":")[0].replace(/\.$/, "").toLowerCase();
}

export function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}

/** True when this request must be refused: an admin path on a host other than ADMIN_HOST. */
export function refuseAdminOnThisHost(hostname: string, pathname: string, adminHost: string | undefined): boolean {
  const allowed = normaliseHost(adminHost);
  if (!allowed) return false;
  if (!isAdminPath(pathname)) return false;
  return normaliseHost(hostname) !== allowed;
}

/**
 * The host whose name the admin-host rule reads. The `Host` header only: the platform (Vercel, or a CDN
 * in front of it) sets it from the address the browser asked for. `X-Forwarded-Host` is not read
 * because a client can send its own, and the rule's job is to refuse /admin on every host but one
 * (security review 2026-11, H-2 / L-14).
 */
export function requestHostname(host: string | null | undefined, fallback: string): string {
  return normaliseHost(host) || normaliseHost(fallback);
}

/**
 * Where a refused admin page goes instead: the same page on ADMIN_HOST, so the site footer's "Insurvas
 * staff" link, the maintenance page's sign-in link and a staff member's old bookmark still arrive. Only a
 * page read (GET or HEAD under /admin) moves; /api/admin and every write stay a plain 404, so nothing of
 * the staff console is ever answered on the customer host.
 */
export function adminPageRedirect(method: string, pathname: string, search: string, adminHost: string | undefined): string | null {
  const host = normaliseHost(adminHost);
  if (!host || !["GET", "HEAD"].includes(method.toUpperCase())) return null;
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return null;
  return `https://${host}${pathname}${search}`;
}

/**
 * What H-2 needs fixed in a production deployment's settings, as sentences; empty when nothing is wrong.
 * Production is VERCEL_ENV=production, or a deployment that names its public hosts (SITE_HOST /
 * APP_HOST); local development always gets an empty list, so the staff alert (lib/adminAlerts) speaks
 * only when it matters.
 *
 * - ADMIN_HOST unset: /admin is answered on the customer hosts.
 * - A cookie domain on the shared parent (`insurvas.com` / `.insurvas.com`): that plane's session cookie
 *   is sent to every subdomain, the other plane's included. The cookie domains are otherwise optional:
 *   left empty, each cookie is host-only on the host that set it, which already keeps the planes apart.
 */
export function adminHostSetupGaps(env: Record<string, string | undefined>): string[] {
  const site = normaliseHost(env.SITE_HOST);
  const production = env.VERCEL_ENV === "production" || Boolean(site || normaliseHost(env.APP_HOST));
  if (!production) return [];
  const gaps: string[] = [];
  if (!normaliseHost(env.ADMIN_HOST)) gaps.push("Set ADMIN_HOST to the admin host (admin.insurvas.com).");
  for (const name of ["ADMIN_COOKIE_DOMAIN", "AGENT_COOKIE_DOMAIN", "PARTNER_COOKIE_DOMAIN"]) {
    const domain = normaliseHost(env[name]).replace(/^\./, "");
    if (domain && site && domain === site) gaps.push(`${name} is the shared parent domain; set it to its own host or leave it empty.`);
  }
  return gaps;
}
