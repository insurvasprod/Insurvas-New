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
