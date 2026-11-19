// Plain module (no `server-only`) so the tests can drive it with a fake client. Its runtime callers
// pass the service-role client.

/**
 * Staff sessions that the server can end (security review 2026-11, M-2).
 *
 * Every staff session token carries the admin's session_version at the moment it was issued (claim
 * `ver`; tokens from before this carry none and count as 0). Every request compares it with
 * admin_users.session_version, so raising the column ends every session of that admin at once:
 * signing out, a super admin's "Sign out everywhere", and deactivating or reactivating the account.
 *
 * admin_users.session_version arrives in 20261117200000_admin_session_version.sql. Until that is
 * applied the column is missing (42703 from a select or filter, PGRST204 from an update payload):
 * the check is skipped, sessions work exactly as before, and nothing can be ended early.
 */

type PostgrestError = { code?: string; message: string } | null;
type Result<T> = { data: T | null; error: PostgrestError };

/** The slice of the Supabase query builder this uses. Typed locally: database.types.ts predates the column. */
export type SessionVersionFilter<T> = PromiseLike<Result<T>> & {
  eq(column: string, value: string | number): SessionVersionFilter<T>;
  select(columns: string): SessionVersionFilter<T>;
  maybeSingle(): PromiseLike<Result<T>>;
};

export type SessionVersionClient = {
  from(table: "admin_users"): {
    select(columns: string): SessionVersionFilter<Record<string, unknown>>;
    update(values: { session_version: number }): SessionVersionFilter<Record<string, unknown>[]>;
  };
};

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export function isMissingSessionVersionColumn(error: PostgrestError): boolean {
  return Boolean(error && error.code && MISSING_COLUMN_CODES.has(error.code));
}

/** The version a token was issued at. Absent or malformed counts as 0, the column's default. */
export function tokenSessionVersion(payload: { ver?: unknown }): number {
  const ver = payload.ver;
  return typeof ver === "number" && Number.isSafeInteger(ver) && ver >= 0 ? ver : 0;
}

/**
 * Whether a token at `tokenVersion` is still a live session. `rowVersion` is null when the column
 * does not exist yet (migration not applied): then every otherwise-valid token is accepted, as before.
 */
export function adminSessionIsCurrent(tokenVersion: number, rowVersion: number | null): boolean {
  if (rowVersion === null) return true;
  return tokenVersion === rowVersion;
}

function versionOf(row: Record<string, unknown> | null): number | null {
  const value = row?.session_version;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/**
 * One admin row with its session_version, for the per-request check. `columns` must not include
 * session_version itself. When the column is missing the row is read without it and `version` is
 * null (check skipped). Any other error returns no row, so the caller refuses the session.
 */
export async function readAdminWithSessionVersion<T extends Record<string, unknown>>(
  client: SessionVersionClient,
  adminId: string,
  columns: string,
): Promise<{ row: T | null; version: number | null }> {
  const first = await client.from("admin_users").select(`${columns}, session_version`).eq("id", adminId).maybeSingle();
  if (!first.error) return { row: (first.data as T | null) ?? null, version: versionOf(first.data) };
  if (!isMissingSessionVersionColumn(first.error)) return { row: null, version: null };

  const fallback = await client.from("admin_users").select(columns).eq("id", adminId).maybeSingle();
  if (fallback.error) return { row: null, version: null };
  return { row: (fallback.data as T | null) ?? null, version: null };
}

/** The version to put in a new session token: the current column value, 0 when there is none yet. */
export async function currentAdminSessionVersion(client: SessionVersionClient, adminId: string): Promise<number | "error"> {
  const { data, error } = await client.from("admin_users").select("session_version").eq("id", adminId).maybeSingle();
  if (error) return isMissingSessionVersionColumn(error) ? 0 : "error";
  return versionOf(data) ?? 0;
}

export type EndSessionsResult =
  /** The version was raised: every session issued before now is refused from the next request. */
  | "ended"
  /** No such admin. */
  | "not_found"
  /** The column does not exist yet (migration not applied). Nothing was ended. */
  | "unavailable"
  /** The read or update failed, or kept losing a race. Nothing is known to have been ended. */
  | "error";

/**
 * Raises admin_users.session_version by one. The raise is conditional on the version read, so two
 * raises at once cannot skip a number or overwrite each other; a lost race is retried.
 */
export async function endAdminSessions(client: SessionVersionClient, adminId: string): Promise<EndSessionsResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await client.from("admin_users").select("session_version").eq("id", adminId).maybeSingle();
    if (read.error) return isMissingSessionVersionColumn(read.error) ? "unavailable" : "error";
    if (!read.data) return "not_found";
    const current = versionOf(read.data);
    if (current === null) return "error";

    const updated = await client
      .from("admin_users")
      .update({ session_version: current + 1 })
      .eq("id", adminId)
      .eq("session_version", current)
      .select("id");
    if (updated.error) return isMissingSessionVersionColumn(updated.error) ? "unavailable" : "error";
    if (updated.data && updated.data.length > 0) return "ended";
  }
  return "error";
}
