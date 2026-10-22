// Pure rules for the platform maintenance gate (SA-4.9). No imports, so node --test can load it and
// the proxy can evaluate it without touching the database for requests it never gates.
//
// The gate runs in proxy.ts for every /api/app and /api/partner request, so a route cannot forget it:
// before this, only routes that went through requireFeature checked maintenance, and every write
// guarded by requireTenant alone (agency profile, team, API keys, profile, onboarding, …) kept
// writing through "read only" and "locked". The admin plane (/api/admin, /admin) is never gated.

export type GateLevel = "off" | "banner_only" | "read_only" | "locked";

export type MaintenanceGateBlock = {
  status: 503;
  code: "maintenance_read_only" | "maintenance_locked";
  level: "read_only" | "locked";
};

/** The API prefixes the gate covers. Anything else (admin, webhooks, cron, public) is untouched. */
export const MAINTENANCE_GATED_PREFIXES = ["/api/app/", "/api/partner/"] as const;

/**
 * Always reachable, at every level. Sign-in, sign-out and password flows decide for themselves
 * (login refuses while locked, logout must always work), and the announcements read is how the
 * app learns that maintenance is on.
 */
export const MAINTENANCE_ALWAYS_OPEN_PREFIXES = [
  "/api/app/auth/",
  "/api/partner/auth/",
] as const;

export const MAINTENANCE_ALWAYS_OPEN_PATHS = ["/api/app/announcements"] as const;

/** Writes still allowed in read_only (but not locked): dismissing the maintenance banner itself. */
const READ_ONLY_OPEN_WRITE = /^\/api\/app\/announcements\/[^/]+\/dismiss\/?$/;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isMaintenanceGatedPath(pathname: string): boolean {
  return MAINTENANCE_GATED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isWriteMethod(method: string): boolean {
  return !READ_METHODS.has(method.toUpperCase());
}

/** Null means "let it through"; otherwise the 503 the proxy answers with. */
export function maintenanceGateDecision(pathname: string, method: string, level: GateLevel): MaintenanceGateBlock | null {
  if (level !== "read_only" && level !== "locked") return null;
  if (!isMaintenanceGatedPath(pathname)) return null;
  if (MAINTENANCE_ALWAYS_OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if ((MAINTENANCE_ALWAYS_OPEN_PATHS as readonly string[]).includes(trimmed)) return null;

  if (level === "locked") {
    if (method.toUpperCase() === "OPTIONS") return null;
    return { status: 503, code: "maintenance_locked", level };
  }

  if (!isWriteMethod(method)) return null;
  if (READ_ONLY_OPEN_WRITE.test(pathname)) return null;
  return { status: 503, code: "maintenance_read_only", level };
}

export function maintenanceGateMessage(block: MaintenanceGateBlock, configured: string | null): string {
  if (configured && configured.trim()) return configured;
  return block.level === "locked"
    ? "The platform is temporarily unavailable while maintenance is underway."
    : "The platform is read-only while maintenance is underway.";
}
