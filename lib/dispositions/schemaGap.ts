/**
 * Settings → Dispositions ships its UI before its migration (20260924140000) is applied. A read that
 * names a column the database does not have yet must degrade to "not set"; a write that needs it
 * must say so plainly instead of failing as a generic 500.
 *
 * Plain module (no server-only) so the message can be shown by the client as well.
 */
export const SCHEMA_PENDING_MESSAGE = "This setting needs a database update that has not been applied yet.";

const MISSING_SCHEMA_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

export function isMissingSchema(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  if (error.code && MISSING_SCHEMA_CODES.has(error.code)) return true;
  // PostgREST reports an unknown column in a select as 42703 inside the message on some versions.
  return /column .* does not exist|Could not find the .* column/i.test(error.message ?? "");
}
