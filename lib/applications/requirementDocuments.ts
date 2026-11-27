import "server-only";

import { auditAfterSubmit } from "./afterAudit";
import { confirmationExtension, isOpenStatus, magicMatches, MAX_CONFIRMATION_BYTES, MAX_CONFIRMATION_LABEL } from "./afterSubmitRules";
import { CONFIRMATION_BUCKET } from "./confirmations";
import { ApplicationError, db } from "./db";
import { attemptHead, fail, updateRequirement, type Actor } from "./requirements";

/**
 * Pages sent to a carrier requirement (the phone's E6b "Send a scanned document"; any client may
 * use it). There is no requirement-documents table or bucket yet, so the pages go where the
 * submission confirmations already live — the private `application-confirmations` bucket (PNG, JPEG
 * or PDF, 25 MB; no storage policy for anyone but the service client) — under the attempt's own
 * folder, `<tenant>/<application>/requirements/<requirement>/<stamp>-<nn>.<ext>`, with the same type
 * and magic-byte checks. Nothing is replaced or deleted. When the last page of a send arrives the
 * requirement goes back to the carrier (in progress, waiting on the carrier) through the one
 * requirement writer, with a dated line added to its note; every page is in the audit log.
 */

export const MAX_REQUIREMENT_PAGES = 20;

export const requirementDocumentPath = (tenantId: string, applicationId: string, requirementId: string, stamp: string, n: number, ext: string) =>
  `${tenantId}/${applicationId}/requirements/${requirementId}/${stamp}-${String(n).padStart(2, "0")}.${ext}`;

/** "26 Nov 2026: 3 pages sent from the phone. Records from 2023–2026 attached" — the line the note keeps. */
export function sentNoteLine(today: string, pages: number, note: string | null): string {
  const d = new Date(`${today}T12:00:00Z`);
  const day = `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
  const base = `${day}: ${pages} page${pages === 1 ? "" : "s"} sent from the phone.`;
  return note?.trim() ? `${base} ${note.trim()}` : base;
}

export async function sendRequirementDocuments(actor: Actor, applicationId: string, requirementId: string, input: {
  files: File[]; note: string | null; page: number | null; pages: number | null;
}) {
  const a = await attemptHead(actor.tenantId, applicationId);
  const r = await db().from("tenant_application_requirements").select("id, kind, status, note")
    .eq("tenant_id", actor.tenantId).eq("application_id", a.id).eq("id", requirementId).maybeSingle();
  if (r.error) fail(r.error, "Could not load the requirement");
  if (!r.data) throw new ApplicationError("REQUIREMENT_NOT_FOUND", "That requirement could not be found.", 404);
  const req = r.data as { id: string; kind: string; status: string; note: string | null };
  if (req.kind === "counteroffer") throw new ApplicationError("REQUIREMENT_IS_COUNTEROFFER", "Answer the counteroffer instead — it takes no pages.", 409);
  if (!isOpenStatus(req.status)) throw new ApplicationError("REQUIREMENT_CLOSED", "That requirement is already closed.", 409);

  const { files } = input;
  if (!files.length) throw new ApplicationError("DOCUMENT_MISSING", "Attach at least one page.");
  if (files.length > MAX_REQUIREMENT_PAGES) throw new ApplicationError("DOCUMENT_TOO_MANY", `Send at most ${MAX_REQUIREMENT_PAGES} pages at a time.`, 413);
  const checked: { bytes: Uint8Array; ext: "png" | "jpg" | "pdf"; type: string }[] = [];
  for (const file of files) {
    if (file.size <= 0) throw new ApplicationError("DOCUMENT_EMPTY", "One of the pages is empty.");
    if (file.size > MAX_CONFIRMATION_BYTES) throw new ApplicationError("DOCUMENT_TOO_LARGE", `Each page must be ${MAX_CONFIRMATION_LABEL} or smaller.`, 413);
    const ext = confirmationExtension(file.type);
    if (!ext) throw new ApplicationError("DOCUMENT_TYPE", "Send a photo (PNG or JPEG) or a PDF.", 415);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!magicMatches(ext, bytes.subarray(0, 8))) throw new ApplicationError("DOCUMENT_TYPE", "That page isn't the image or PDF it says it is.", 415);
    checked.push({ bytes, ext, type: file.type });
  }

  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 15);
  const first = input.page && input.page > 0 ? input.page : 1;
  const paths: string[] = [];
  for (const [i, f] of checked.entries()) {
    const path = requirementDocumentPath(actor.tenantId, a.id, req.id, `${stamp}-${crypto.randomUUID().slice(0, 8)}`, first + i, f.ext);
    const up = await db().storage.from(CONFIRMATION_BUCKET).upload(path, f.bytes, { contentType: f.type, upsert: false });
    if (up.error) throw new ApplicationError("DOCUMENT_STORAGE", `Could not store the page: ${up.error.message}`, 500);
    paths.push(path);
  }
  await auditAfterSubmit({
    actorId: actor.userId, action: "tenant.application_requirement_updated", targetId: a.id,
    metadata: { requirementId: req.id, fields: ["documents"], pages: paths.length, page: input.page, of: input.pages, bytes: checked.reduce((n, f) => n + f.bytes.length, 0), paths },
    request: actor.request,
  });

  // The last page of a send (or a send with no page count) hands the requirement back to the carrier.
  const last = !input.pages || !input.page || input.page + checked.length - 1 >= input.pages;
  if (!last) return { stored: paths.length, status: req.status, sent: false };
  const total = input.pages ?? checked.length;
  const line = sentNoteLine(new Date().toISOString().slice(0, 10), total, input.note);
  const note = [req.note?.trim(), line].filter(Boolean).join("\n").slice(0, 4000);
  const updated = await updateRequirement(actor, a.id, req.id, { status: "in_progress", waiting_on: "carrier", note });
  return { stored: paths.length, status: updated.status, sent: true };
}
