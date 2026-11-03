/**
 * "This column or table is not in the database yet."
 *
 * The settings screens ship before their migrations are applied (this environment cannot apply
 * DDL). Reads treat a missing column or table as "not set"; writes that need one refuse with a
 * sentence the screen can show inline, instead of a Postgres error code.
 *
 *   42703  undefined_column      (Postgres, via RPC)
 *   42P01  undefined_table       (Postgres, via RPC)
 *   PGRST204  column not in the schema cache   (PostgREST)
 *   PGRST205  table not in the schema cache    (PostgREST)
 */
export const SCHEMA_GAP_MESSAGE = "This setting needs a database update that has not been applied yet.";

const CODES = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]);

export function isSchemaGap(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && CODES.has(error.code)) return true;
  const message = error.message ?? "";
  return /column .* does not exist|relation .* does not exist|could not find the .* column|schema cache/i.test(message);
}

/** Thrown by a writer when the schema it needs is missing. Routes turn it into HTTP 503. */
export class SchemaGapError extends Error {
  constructor() {
    super(SCHEMA_GAP_MESSAGE);
    this.name = "SchemaGapError";
  }
}
