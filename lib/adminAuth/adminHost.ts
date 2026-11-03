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
