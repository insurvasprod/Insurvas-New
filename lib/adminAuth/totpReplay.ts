// Plain module (no `server-only`) so the tests can drive it with a fake client. Its only runtime
// caller is POST /api/admin/auth/verify-2fa, which passes the service-role client.

/**
 * Second-factor replay protection (user decision): a code whose time step is <= the last step
 * accepted for that admin is refused, so a code seen over a shoulder, in a screen recording or in
 * a proxy log cannot be used again, even inside its 30-90 second validity window.
 *
 * The compare and the set are ONE statement:
 *
 *   update admin_users set last_totp_step = <step>
 *    where id = <admin> and (last_totp_step is null or last_totp_step < <step>)
 *   returning id
 *
 * Postgres re-checks the WHERE clause against the committed row when two updates race for it, so
 * of two concurrent verifies with the same code exactly one gets its row back; the other matches
 * nothing and is refused. A read-then-write in application code would let both through.
 *
 * admin_users.last_totp_step arrives in 20260924364000_admin_totp_replay_guard.sql. Until that is
 * applied the column is missing (42703 from the filter, PGRST204 from the payload) and the check is
 * skipped — sign-in keeps working exactly as it did, and the lockout still applies, since it needs
 * no migration.
 */

export type TotpStepClaim =
  /** The step was newer than any accepted before, and is now the last accepted step. */
  | "claimed"
  /** The step is not newer than the last accepted one: this code (or an older one) was used. */
  | "replayed"
  /** The column does not exist yet (migration not applied). Nothing was checked. */
  | "unavailable"
  /** The update failed for another reason. Callers fail closed. */
  | "error";

type PostgrestError = { code?: string; message: string } | null;
type UpdateResult = { data: unknown[] | null; error: PostgrestError };

/** The slice of the Supabase query builder this uses. Typed locally: database.types.ts predates the column. */
export type TotpStepFilter = {
  eq(column: "id", value: string): TotpStepFilter;
  or(filters: string): TotpStepFilter;
  select(columns: "id"): PromiseLike<UpdateResult>;
};

export type TotpStepClient = {
  from(table: "admin_users"): {
    update(values: { last_totp_step: number }): TotpStepFilter;
  };
};

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export function isMissingTotpStepColumn(error: PostgrestError): boolean {
  return Boolean(error && error.code && MISSING_COLUMN_CODES.has(error.code));
}

export async function claimTotpStep(client: TotpStepClient, adminId: string, step: number): Promise<TotpStepClaim> {
  // Integer-only by construction (verifyTotpStep returns a counter); checked anyway because it is
  // interpolated into the PostgREST filter string.
  if (!Number.isSafeInteger(step) || step < 0) return "error";

  const { data, error } = await client
    .from("admin_users")
    .update({ last_totp_step: step })
    .eq("id", adminId)
    .or(`last_totp_step.is.null,last_totp_step.lt.${step}`)
    .select("id");

  if (error) return isMissingTotpStepColumn(error) ? "unavailable" : "error";
  return data && data.length > 0 ? "claimed" : "replayed";
}
