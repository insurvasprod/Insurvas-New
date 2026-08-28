import "server-only";
import type { PoolClient } from "pg";

import { getTenantPool } from "./pool";

/**
 * Runs `fn` inside a transaction with Postgres session variables set so RLS policies
 * (tenant_self_read, tenant_users_scoped, users_scoped_to_tenant) can scope every query to this
 * tenant — set_config's third argument (`true`) makes it transaction-local, so it can never leak
 * across pooled connections between requests.
 */
export async function withTenantScope<T>(
  tenantId: string,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getTenantPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [
      tenantId,
      userId,
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
