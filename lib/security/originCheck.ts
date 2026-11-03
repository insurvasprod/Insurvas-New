// Cross-site request refusal for the cookie-authenticated API planes (LA-1 audit).
//
// The session cookies are SameSite=Lax, which stops most cross-site POSTs but not all (a top-level
// form POST from a sibling subdomain is same-site, and Lax has had browser exceptions). So every
// state-changing request to /api/app, /api/partner and /api/admin must come from this app's own
// origin or a configured app/admin host.
//
// Plain module (no `server-only`, no Next imports) so proxy.ts, route handlers and the tests share it.
//
// - Safe methods (GET, HEAD, OPTIONS) are never checked: they must not change anything.
// - A request carrying an Authorization header authenticates by token, not by an ambient cookie, so
//   it is not a CSRF vector (the browser extension's bearer routes, scripted clients).
// - No Origin and no Referer: not a browser form or fetch from another site (browsers send Origin on
//   every cross-origin POST), so it is allowed; the route's own auth still runs.
// - Origin "null" (sandboxed frames, some redirects) is refused.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const CROSS_SITE_REFUSED = { error: "This request came from another site and was refused.", code: "cross_site_request" } as const;

/** host[:port], lower-cased, from a URL or a bare host; empty when unparseable. */
export function hostOf(value: string | null | undefined): string {
  const raw = (value ?? "").split(",")[0].trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).host.toLowerCase();
  } catch {
    return "";
  }
}

export function isProtectedApiPath(pathname: string): boolean {
  return ["/api/app", "/api/partner", "/api/admin"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export type OriginCheckInput = {
  method: string;
  pathname: string;
  origin: string | null;
  referer: string | null;
  authorization: string | null;
  /** The host the request was addressed to (x-forwarded-host, else host). */
  requestHost: string | null;
  /** Configured app/admin URLs or hosts (NEXT_PUBLIC_APP_URL, ADMIN_HOST, …). */
  allowedHosts: ReadonlyArray<string | null | undefined>;
};

/** True when the request must be refused as cross-site. */
export function refuseCrossSite(input: OriginCheckInput, options: { paths?: (pathname: string) => boolean } = {}): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return false;
  if (!(options.paths ?? isProtectedApiPath)(input.pathname)) return false;
  if (input.authorization && input.authorization.trim()) return false;
  const origin = input.origin?.trim() || null;
  if (origin === "null") return true;
  const source = origin ?? (input.referer?.trim() || null);
  if (!source) return false;
  const sourceHost = hostOf(source);
  if (!sourceHost) return true;
  const allowed = new Set([hostOf(input.requestHost), ...input.allowedHosts.map(hostOf)].filter(Boolean));
  return !allowed.has(sourceHost);
}

/** The configured hosts the app and admin planes are served from. */
export function configuredHosts(env: Record<string, string | undefined>): string[] {
  return [env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_AGENT_APP_URL, env.NEXT_PUBLIC_PARTNER_APP_URL, env.APP_URL, env.ADMIN_HOST].filter((value): value is string => Boolean(value));
}
