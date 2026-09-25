/**
 * "This part of the schema is not deployed yet", for the carrier library and agency profile.
 *
 * Wraps the shared detector and adds PGRST202 (PostgREST: no function with these argument names),
 * which is how a call to an RPC overload from an unapplied migration fails. Reads that hit a gap
 * degrade to null/empty; writes surface SCHEMA_PENDING_MESSAGE as HTTP 503.
 */
import { isSchemaGap, type QueryError } from "@/lib/supabase/schemaGap";

export const SCHEMA_PENDING_MESSAGE = "This setting needs a database update that has not been applied yet.";

export function isPendingSchema(error: QueryError): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true;
  return isSchemaGap(error) || /could not find the function/i.test(error.message);
}

/** Thrown by a write whose table, column or function a pending migration has not created. */
export class SchemaPendingError extends Error {
  constructor() {
    super(SCHEMA_PENDING_MESSAGE);
    this.name = "SchemaPendingError";
  }
}
