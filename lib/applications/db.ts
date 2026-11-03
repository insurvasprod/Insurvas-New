import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

// The LA-3 tables are newer than the generated database types; queries go through this one loose
// handle, and every query carries an explicit tenant filter because the service client bypasses RLS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function db(): any {
  return getSupabaseServiceClient();
}

export type DbError = { code?: string; message?: string } | null | undefined;

/** A table, column or function that has not been applied yet (the SQL editor is the only way in). */
export function isMissingSchema(error: DbError) {
  if (!error) return false;
  if (["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  return /schema cache|does not exist|Could not find the (function|table|column)/i.test(error.message ?? "");
}

export class ApplicationError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "ApplicationError";
  }
}

/** The schema for this step is not live yet. Routes answer 503 with `schemaPending: true`. */
export class SchemaPendingError extends ApplicationError {
  constructor(what: string) {
    super("SCHEMA_PENDING", `${what} is not set up yet — its migration has not been applied.`, 503);
  }
}

const RPC_MESSAGES: Record<string, [string, number]> = {
  APPLICATION_NOT_FOUND: ["That application could not be found.", 404],
  APPLICATION_CLOSED: ["This attempt is closed. Start a new attempt instead.", 409],
  APPLICATION_TRANSITION_INVALID: ["That step isn't allowed from where the application is now.", 409],
  APPLICATION_OUTCOME_REASON_REQUIRED: ["Choose a reason for this outcome.", 400],
  NEXT_ATTEMPT_NOT_ALLOWED: ["A new attempt can only follow a declined, postponed or refused attempt on an open case.", 409],
};

/** Turn an RPC error into the ApplicationError its code names, or rethrow as unavailable. */
export function rpcError(error: DbError, fallback: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError(fallback);
  const code = Object.keys(RPC_MESSAGES).find((known) => error?.message?.includes(known));
  if (code) throw new ApplicationError(code, RPC_MESSAGES[code][0], RPC_MESSAGES[code][1]);
  throw new ApplicationError("APPLICATION_UNAVAILABLE", `${fallback}: ${error?.message ?? "unknown error"}`, 500);
}

export function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}
