import "server-only";
import { Pool } from "pg";

let _pool: Pool | null = null;

/**
 * Postgres connection (via the Supavisor pooler, transaction mode) as the `tenant_app` role
 * (SA-0.2 migration) — NOBYPASSRLS, unlike the Supabase service-role client used elsewhere in
 * this app. Row-level security on tenants/users/tenant_users actually applies to every query
 * run through this pool.
 *
 * Only for tenant-scoped reads after a session exists (see withTenantScope). Login itself has no
 * tenant to scope to yet, so it goes through the service-role client instead, same as admin login.
 */
export function getTenantPool(): Pool {
  if (_pool) return _pool;

  const connectionString = process.env.TENANT_DB_URL;
  if (!connectionString) {
    throw new Error("Missing TENANT_DB_URL env var.");
  }

  _pool = new Pool({
    connectionString,
    max: 5,
    ssl: { rejectUnauthorized: false },
  });

  return _pool;
}
