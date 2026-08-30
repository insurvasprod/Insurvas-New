import "server-only";

// SA-5.4 · Recording acceptance, and deciding who still owes one.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getClientIp, getUserAgent } from "@/lib/request/clientInfo";
import { SIGNUP_REQUIRED_DOCS, type LegalDocumentSummary } from "./constants";

export class LegalError extends Error {}

export type AcceptanceContext = "signup" | "reacceptance";

/**
 * Records one user's acceptance of specific documents.
 *
 * Takes document IDs, not types — the ID pins the exact version. Recording "accepted the terms"
 * and looking up the current version at read time would silently re-date every historical
 * acceptance the moment a new version was published, which is the failure this ticket exists to
 * prevent.
 */
export async function recordAcceptances(
  userId: string,
  documentIds: string[],
  context: AcceptanceContext,
  request: Request,
): Promise<void> {
  if (documentIds.length === 0) return;

  const supabase = getSupabaseServiceClient();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  for (const documentId of documentIds) {
    const { error } = await supabase.rpc("record_legal_acceptance", {
      p_user_id: userId,
      p_document_id: documentId,
      p_ip: ip,
      p_user_agent: userAgent,
      p_context: context,
    });

    // Thrown rather than logged: an acceptance we failed to record is an acceptance we cannot
    // prove, and letting the user through would leave us believing something we cannot evidence.
    if (error) throw new LegalError(`Could not record acceptance: ${error.message}`);
  }
}

/**
 * The documents a user must accept before continuing.
 *
 * Empty for a user who is up to date. Non-empty after a material new version is published, which
 * is what drives the gate.
 */
export async function outstandingDocuments(userId: string): Promise<LegalDocumentSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("outstanding_legal_documents", { p_user_id: userId });

  if (error) {
    // Failing open here is deliberate and is the lesser evil: a database blip must not lock every
    // customer out of the product. It is logged loudly because the gate is silently not running.
    console.error("[legal] could not compute outstanding documents — gate skipped for", userId, error);
    return [];
  }

  return (data as LegalDocumentSummary[] | null) ?? [];
}

/**
 * The documents a signup must tick, and whether they are all present.
 *
 * If a required document has never been published, signup cannot honestly ask anyone to agree to
 * it — so this reports the gap rather than silently accepting nothing.
 */
export async function documentsRequiredAtSignup(): Promise<{
  documents: LegalDocumentSummary[];
  missing: string[];
}> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("current_legal_documents")
    .select("*")
    .in("doc_type", SIGNUP_REQUIRED_DOCS);

  const documents = (data as LegalDocumentSummary[] | null) ?? [];
  const present = new Set(documents.map((d) => d.doc_type));

  return {
    documents: documents.sort(
      (a, b) => SIGNUP_REQUIRED_DOCS.indexOf(a.doc_type) - SIGNUP_REQUIRED_DOCS.indexOf(b.doc_type),
    ),
    missing: SIGNUP_REQUIRED_DOCS.filter((t) => !present.has(t)),
  };
}

/**
 * Checks that a signup ticked exactly the documents it was shown.
 *
 * Compares against what is published right now rather than trusting the ids the browser sent. A
 * form left open while v2 was published must not record agreement to v1 — the person would be
 * agreeing to text that is no longer the offer.
 */
export function verifySignupAcceptance(
  submittedIds: string[],
  currentDocuments: LegalDocumentSummary[],
): { ok: true; documentIds: string[] } | { ok: false; error: string } {
  if (currentDocuments.length === 0) {
    return { ok: false, error: "No terms have been published yet, so they cannot be accepted." };
  }

  const submitted = new Set(submittedIds);
  const missing = currentDocuments.filter((d) => !submitted.has(d.id));

  if (missing.length > 0) {
    return {
      ok: false,
      error:
        missing.length === currentDocuments.length
          ? "You must accept the terms and privacy policy to continue."
          : `A newer version of the ${missing[0].title} was published. Please review and accept it.`,
    };
  }

  return { ok: true, documentIds: currentDocuments.map((d) => d.id) };
}
