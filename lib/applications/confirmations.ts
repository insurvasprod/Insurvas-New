import "server-only";

import { effectiveCarrierFacts } from "@/lib/salesSettings/carriers";
import { auditAfterSubmit } from "./afterAudit";
import { confirmationExtension, confirmationPath, magicMatches, MAX_CONFIRMATION_BYTES, normaliseReference, patternExample, referencePatternCheck } from "./afterSubmitRules";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";
import { attemptHead, fail, type Actor } from "./requirements";

/**
 * LA-3.15 submission confirmations and reference checks.
 *
 * The screenshot (or the carrier's PDF) goes to the private `application-confirmations` bucket at
 * `<tenant>/<application>/<submission>.<ext>` through the service client — no storage policy exists
 * for anyone else — and is only ever read back as a 60-second signed URL after the tenant is
 * checked. A confirmation, once attached, is never replaced or deleted.
 */

export const CONFIRMATION_BUCKET = "application-confirmations";

type SubmissionHead = { id: string; tenant_id: string; application_id: string; confirmation_path: string | null; carrier_id: string };

async function submissionHead(submissionId: string): Promise<SubmissionHead | null> {
  // Looked up by id alone, so a row in another tenant is a 403, not an ambiguous 404.
  const q = await db().from("tenant_application_submissions").select("id, tenant_id, application_id, confirmation_path, carrier_id").eq("id", submissionId).maybeSingle();
  if (q.error) { if (isMissingSchema(q.error)) throw new SchemaPendingError("Submission capture"); fail(q.error, "Could not load the submission"); }
  return (q.data ?? null) as SubmissionHead | null;
}

function guardTenant(s: SubmissionHead | null, tenantId: string, applicationId: string): SubmissionHead {
  if (!s) throw new ApplicationError("SUBMISSION_NOT_FOUND", "That submission could not be found.", 404);
  if (s.tenant_id !== tenantId) throw new ApplicationError("FORBIDDEN", "That confirmation belongs to another agency.", 403);
  if (s.application_id !== applicationId) throw new ApplicationError("SUBMISSION_NOT_FOUND", "That submission is not on this application.", 404);
  return s;
}

export async function attachConfirmation(actor: Actor, applicationId: string, submissionId: string, file: File) {
  await attemptHead(actor.tenantId, applicationId, { allowClosed: true });
  const s = guardTenant(await submissionHead(submissionId), actor.tenantId, applicationId);
  if (s.confirmation_path) throw new ApplicationError("CONFIRMATION_ATTACHED", "A confirmation is already attached to this submission — it is kept as it was.", 409);
  if (file.size <= 0) throw new ApplicationError("CONFIRMATION_EMPTY", "That file is empty.");
  if (file.size > MAX_CONFIRMATION_BYTES) throw new ApplicationError("CONFIRMATION_TOO_LARGE", "The confirmation must be 10 MB or smaller.", 413);
  const ext = confirmationExtension(file.type);
  if (!ext) throw new ApplicationError("CONFIRMATION_TYPE", "Attach a PNG or JPEG screenshot, or a PDF.", 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!magicMatches(ext, bytes.subarray(0, 8))) throw new ApplicationError("CONFIRMATION_TYPE", "That file isn't the image or PDF it says it is.", 415);

  const path = confirmationPath(actor.tenantId, applicationId, submissionId, ext);
  const up = await db().storage.from(CONFIRMATION_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error) throw new ApplicationError("CONFIRMATION_STORAGE", `Could not store the confirmation: ${up.error.message}`, 500);
  // Only a submission without one takes it: two uploads at once cannot both attach.
  const set = await db().from("tenant_application_submissions").update({ confirmation_path: path }).eq("tenant_id", actor.tenantId).eq("id", submissionId).is("confirmation_path", null).select("id");
  if (set.error) fail(set.error, "Could not attach the confirmation");
  if (!rows(set.data).length) throw new ApplicationError("CONFIRMATION_ATTACHED", "A confirmation is already attached to this submission.", 409);
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_confirmation_attached", targetId: applicationId, metadata: { submissionId, bytes: file.size, type: file.type }, request: actor.request });
  return { attached: true, type: ext };
}

/** A 60-second signed URL, after the tenant check (a cross-tenant request is a 403). */
export async function confirmationUrl(tenantId: string, applicationId: string, submissionId: string) {
  const s = guardTenant(await submissionHead(submissionId), tenantId, applicationId);
  if (!s.confirmation_path) throw new ApplicationError("CONFIRMATION_MISSING", "No confirmation is attached to this submission.", 404);
  if (!s.confirmation_path.startsWith(`${tenantId}/`)) throw new ApplicationError("FORBIDDEN", "That confirmation belongs to another agency.", 403);
  const signed = await db().storage.from(CONFIRMATION_BUCKET).createSignedUrl(s.confirmation_path, 60);
  if (signed.error || !signed.data?.signedUrl) throw new ApplicationError("CONFIRMATION_STORAGE", "Could not open the confirmation.", 500);
  return { url: signed.data.signedUrl as string, expiresInSeconds: 60 };
}

/**
 * Before the capture is saved: does the reference look like this carrier's, and has it been used on
 * another application in the agency? Both are warnings — the carrier's screen is the authority.
 */
export async function checkReference(tenantId: string, applicationId: string, reference: string) {
  const a = await attemptHead(tenantId, applicationId, { allowClosed: true });
  const ref = reference.trim();
  let pattern: string | null = null;
  let carrierName: string | null = null;
  if (a.carrier_id) {
    // The agency's own pattern first, then the library's (LA-3.17 carrier overrides).
    const [c, facts] = await Promise.all([
      db().from("carriers").select("name").eq("id", a.carrier_id).maybeSingle(),
      effectiveCarrierFacts(tenantId, [a.carrier_id]).catch(() => new Map()),
    ]);
    pattern = facts.get(a.carrier_id)?.referencePattern ?? null;
    carrierName = (c.data?.name as string | null) ?? null;
  }
  const format = referencePatternCheck(pattern, ref);
  let duplicate: { applicationId: string; caseId: string; clientName: string; submittedAt: string; attemptNo: number; sameCase: boolean } | null = null;
  if (a.carrier_id && ref) {
    const dup = await db().from("tenant_application_submissions").select("application_id, submitted_at, attempt_no")
      .eq("tenant_id", tenantId).eq("carrier_id", a.carrier_id).in("carrier_reference", [...new Set([ref, normaliseReference(ref), ref.toUpperCase()])]).neq("application_id", applicationId)
      .order("submitted_at", { ascending: false }).limit(1).maybeSingle();
    if (dup.data) {
      const other = await db().from("tenant_applications").select("case_id, lead_id").eq("tenant_id", tenantId).eq("id", dup.data.application_id).maybeSingle();
      const lead = other.data ? await db().from("agent_leads").select("values").eq("tenant_id", tenantId).eq("id", other.data.lead_id).maybeSingle() : { data: null };
      const v = ((lead.data as { values?: Record<string, unknown> } | null)?.values ?? {}) as Record<string, unknown>;
      const name = (typeof v.full_name === "string" && v.full_name.trim()) || [v.first_name, v.last_name].filter((x) => typeof x === "string" && x).join(" ") || "another client";
      duplicate = { applicationId: dup.data.application_id, caseId: other.data?.case_id ?? "", clientName: name, submittedAt: dup.data.submitted_at, attemptNo: dup.data.attempt_no, sameCase: other.data?.case_id === a.case_id };
    }
  }
  return { format, example: patternExample(pattern), carrierName, duplicate };
}
