/**
 * "The column is not there yet." This screen's code ships before its migration
 * (20260924130000) is applied, so reads treat a missing column or table as empty and writes that
 * need one answer 503 with a sentence a person can act on.
 */
const MISSING_SCHEMA = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

export function isMissingSchema(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && MISSING_SCHEMA.has(error.code)) return true;
  // PostgREST sometimes reports a missing column only in the message.
  return /column .* does not exist|could not find the '.*' column/i.test(error.message ?? "");
}

export const SCHEMA_PENDING_MESSAGE = "This setting needs a database update that has not been applied yet.";

export class SchemaPendingError extends Error {
  constructor() {
    super(SCHEMA_PENDING_MESSAGE);
    this.name = "SchemaPendingError";
  }
}
