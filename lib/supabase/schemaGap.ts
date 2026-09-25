/**
 * Tells "this object is not deployed yet" apart from "this query failed".
 *
 * The distinction matters because the two deserve opposite handling. A permission problem, a broken
 * connection or a bad column reference is a fault and must surface loudly. A view that a pending
 * migration has not created yet is a **known, temporary gap**, and collapsing a whole screen over
 * it means a partially-migrated database takes out pages that could still do most of their job.
 *
 * Observed: `/app/campaigns` reported nothing but "could not be loaded" on both panels while the
 * vendors and campaigns themselves were sitting in base tables the page never tried to read.
 *
 * Deliberately narrow. It matches a missing relation or column and nothing else — not a timeout,
 * not a permission denial, not a constraint violation. Widening this would turn real faults into
 * silently degraded screens, which is the failure mode it exists to prevent.
 */
export type QueryError = { message: string; code?: string } | null;

/** Postgres and PostgREST codes for "the thing you named is not there". */
const GAP_CODES = new Set([
  "42P01", // undefined_table — a missing table or view
  "42703", // undefined_column — the relation exists but not the column
  "PGRST205", // PostgREST: could not find the table in the schema cache
  "PGRST204", // PostgREST: could not find the column in the schema cache
]);

export function isSchemaGap(error: QueryError): boolean {
  if (!error) return false;
  if (error.code && GAP_CODES.has(error.code)) return true;
  // PostgREST does not always set a code on schema-cache misses, and the message is the only signal.
  // Anchored on the specific phrases it emits rather than on "not found" generally.
  return /could not find the (table|column)|schema cache|relation .* does not exist|column .* does not exist/i.test(
    error.message,
  );
}

/**
 * What a screen could not show, in words a person can act on. Returned alongside the data rather
 * than in place of it, so the page can render what it has and still say what is missing.
 */
export type SchemaGapNotice = {
  /** Machine-readable, for the UI to decide which columns to blank. */
  missing: string[];
  /** One sentence, shown as-is. */
  detail: string;
};
