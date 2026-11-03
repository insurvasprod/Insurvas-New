import { isSchemaGap, type QueryError } from "@/lib/supabase/schemaGap";

/**
 * Settings › States & licences and Team & access store fields that arrive with migration
 * 20260924110000. Until it is applied, reads treat them as "not recorded" and writes that need them
 * answer 503 with this sentence, which the screen shows inline next to the control.
 *
 * Plain module (no server-only) so the client can compare against the same sentence.
 */
export const SCHEMA_PENDING_MESSAGE = "This setting needs a database update that has not been applied yet.";

/** A missing table/column, or a missing function (the licensed-states RPC). */
export function isPendingSchema(error: QueryError): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return isSchemaGap(error) || /could not find the function/i.test(error.message);
}

export class SchemaPendingError extends Error {
  constructor() {
    super(SCHEMA_PENDING_MESSAGE);
    this.name = "SchemaPendingError";
  }
}

export function schemaPendingBody() {
  return { error: SCHEMA_PENDING_MESSAGE, code: "schema_pending" } as const;
}
