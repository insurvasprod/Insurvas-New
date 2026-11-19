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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only statements under the same transaction-local scope as `withTenantScope`, sent to the pooler as ONE
 * message (speed pass 2026-11-12): BEGIN, the scope, the reads and COMMIT were five round trips one after another,
 * about 150 ms each, for /api/app/me. The ids are inlined, so each must be a UUID (they come from a verified
 * session); `statements` are fixed SQL with no input of their own, written as `$tenant` / `$user` where an id goes.
 * Returns each statement's rows, in order.
 */
export async function readTenantScoped(tenantId: string, userId: string, statements: string[]): Promise<Record<string, unknown>[][]> {
  if (!UUID.test(tenantId) || !UUID.test(userId)) throw new Error("readTenantScoped: ids must be UUIDs");
  const fill = (sql: string) => sql.replaceAll("$tenant", `'${tenantId}'`).replaceAll("$user", `'${userId}'`);
  const text = [
    "BEGIN",
    `select set_config('app.tenant_id', '${tenantId}', true), set_config('app.user_id', '${userId}', true)`,
    ...statements.map(fill),
    "COMMIT",
  ].join(";\n");
  const client = await getTenantPool().connect();
  try {
    // A multi-statement simple query answers with one result per statement.
    const results = (await client.query(text)) as unknown as { rows: Record<string, unknown>[] }[];
    return results.slice(2, 2 + statements.length).map((result) => result.rows);
  } catch (error) {
    // A failed statement leaves the explicit transaction open and aborted on this connection.
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
