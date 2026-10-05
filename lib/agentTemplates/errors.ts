const IMPORT_CONTRACT_ERROR = /column [^\n]*tenant_id[^\n]*does not exist|relation [^\n]* does not exist|import_agent_lead_batch|could not find the function|schema cache/i;

export const IMPORT_UNAVAILABLE_MESSAGE =
  "Lead import is temporarily unavailable while its database contract is being updated. No leads were created. Please try again later.";

export type ImportFailure = {
  code: "import_unavailable" | "import_failed";
  message: string;
  status: 400 | 503;
  /**
   * The original error text, kept for the operator. `message` above is deliberately vague — the
   * person importing can do nothing about a missing relation and should not be shown one — but
   * somebody has to be able to find out what actually broke.
   */
  cause: string;
};

/**
 * Pure: no imports, no side effects. `lib/agentTemplates/importBatch.test.mjs` loads this module
 * directly under `node --test`, where `next/server` does not resolve, so nothing here may reach for
 * a framework type. An earlier version of `recordImportFailure` returned a `NextResponse` and broke
 * that suite instantly.
 */
export function classifyImportFailure(error: unknown): ImportFailure {
  const raw = error instanceof Error ? error.message : "";
  // A database refusal already put into words: the person sees the words, the log keeps the cause.
  if (error instanceof ImportDatabaseError)
    return { code: "import_failed", message: error.message, status: 400, cause: error.internal };
  if (IMPORT_CONTRACT_ERROR.test(raw)) {
    return { code: "import_unavailable", message: IMPORT_UNAVAILABLE_MESSAGE, status: 503, cause: raw };
  }
  return {
    code: "import_failed",
    message: raw || "Could not import leads",
    status: 400,
    cause: raw,
  };
}

/**
 * A refusal from the database during a commit, in words the person importing can act on.
 *
 * LA-2.2-9 found the raw Postgres text on the import screen ("unsupported Unicode escape
 * sequence"). `message` is what the screen shows; `internal` is the original, kept for the
 * operator's log and the batch row.
 */
export class ImportDatabaseError extends Error {
  // A plain field, not a parameter property: node --test strips types and cannot run those.
  readonly internal: string;
  constructor(message: string, internal: string) {
    super(message);
    this.internal = internal;
  }
}

const NOTHING_IMPORTED = "Nothing was imported.";

/**
 * The words for a database error raised while committing an import. Returns null for the errors a
 * caller answers differently (an already-committed batch, a spend it names itself) and for a missing
 * function, which `classifyImportFailure` reports as a deployment fault.
 */
export function friendlyImportCommitError(error: { message?: string | null; code?: string | null } | null | undefined): ImportDatabaseError | null {
  if (!error) return null;
  const raw = error.message ?? "";
  const code = error.code ?? "";
  const say = (message: string) => new ImportDatabaseError(`${message} ${NOTHING_IMPORTED}`, raw || code);
  if (/IMPORT_BATCH_ALREADY_COMMITTED|IMPORT_SPEND_OVERFLOW|IMPORT_SPEND_INVALID/.test(raw)) return null;
  if (IMPORT_CONTRACT_ERROR.test(raw) || ["PGRST202", "42883"].includes(code)) return null;
  if (/IMPORT_ACTOR_INVALID/.test(raw)) return say("Your account cannot import leads into this workspace right now. Ask an owner to check your access.");
  if (/IMPORT_CAMPAIGN_SCOPE_INVALID|REJECTION_CAMPAIGN_SCOPE_INVALID|REJECTION_SCOPE_INVALID/.test(raw)) return say("The campaign this list belongs to could not be found. Choose the campaign again and upload the file.");
  if (/IMPORT_LEAD_SCOPE_INVALID/.test(raw)) return say("A lead this file matched was removed while the list was being reviewed. Upload the file again.");
  if (/IMPORT_BATCH_NOT_FOUND/.test(raw)) return say("This review is no longer on file. Upload the file again.");
  if (/IMPORT_BATCH_SIZE_INVALID/.test(raw)) return say("A file can hold at most 20,000 rows. Split it and import each part.");
  if (/IMPORT_ITEM_INVALID|IMPORT_BATCH_INVALID|REJECTION_PAYLOAD_INVALID/.test(raw)) return say("One of the rows could not be saved as a lead. Check the file's stage column and upload it again.");
  // PGRST102 "Empty or invalid json": PostgREST refusing the payload, e.g. a broken (lone-surrogate) character in a cell.
  if (code === "22P05" || code === "PGRST102" || /unsupported Unicode escape sequence|\\u0000|invalid byte sequence|Empty or invalid json|surrogate/i.test(raw))
    return say("A cell in the file holds a hidden character the database cannot store. Re-save the file as plain CSV (UTF-8) and upload it again.");
  if (code === "22001" || /value too long/i.test(raw)) return say("A value in the file is longer than a lead can hold. Shorten it and upload the file again.");
  if (code === "22007" || code === "22008" || /invalid input syntax for type (timestamp|date)|date\/time field value out of range/i.test(raw))
    return say("A date in the file could not be read. Check the date columns and upload the file again.");
  if (code === "57014" || /statement timeout|canceling statement/i.test(raw)) return say("The import took too long and was stopped. Try again in a moment, or split the file.");
  if (code === "23505") return say("Part of this file was saved by another import at the same moment. Refresh and check the lead list before trying again.");
  if (code === "23503") return say("Something this file refers to was removed while it was being imported. Upload the file again.");
  if (code === "23514") return say("One of the rows breaks a rule the database enforces. Check the file and upload it again.");
  // Not "nothing was imported": the connection can drop after the database committed. The batch
  // lock makes a second press safe either way — it answers "already imported" rather than doubling.
  if (/fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(raw))
    return new ImportDatabaseError("The connection to the database dropped before it answered. Press Import again: if the list already went in, it says so instead of importing it twice.", raw);
  return say("The database refused this import.");
}

/**
 * Classify AND record. Import routes call this rather than `classifyImportFailure`.
 *
 * The bug this exists to prevent, which was live in all three import routes:
 *
 *     const failure = classifyImportFailure(error);
 *     return NextResponse.json({ error: failure.message, ... }, { status: failure.status });
 *
 * `error` was never logged anywhere. So when the database contract was broken, the person importing
 * saw "temporarily unavailable … please try again later" — a permanent schema fault described as a
 * transient one, which invites retrying forever — and the operator saw **nothing at all**. No
 * console line, no audit row, no stack. The actual cause (`column "tenant_id" does not exist`, or a
 * missing relation) was classified and then discarded in the same expression.
 *
 * That is how the actor-membership defect stayed invisible for as long as it did: the handler added
 * to make the failure graceful also deleted the only evidence that it had happened. A 503 nobody can
 * diagnose is worse than a 500 with a stack trace, because it looks handled.
 *
 * The user-facing message stays vague on purpose — "your database is missing a view" is not
 * actionable for an agent uploading a spreadsheet. The split is the point: the user gets a calm,
 * honest "nothing was created", and the log gets the truth.
 */
export function recordImportFailure(error: unknown, context: string): ImportFailure {
  const failure = classifyImportFailure(error);
  if (failure.code === "import_unavailable") {
    // error, not warn: this is a deployment fault. A migration the code depends on is not applied,
    // and every import will fail identically until somebody applies it.
    console.error(
      `[import] ${context}: database contract failure, no leads created — ${failure.cause || "(no message)"}`,
    );
  }
  return failure;
}
