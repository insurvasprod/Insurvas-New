import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { MAX_CONFIRMATION_BYTES } from "@/lib/applications/afterSubmitRules";
import { MAX_REQUIREMENT_PAGES, sendRequirementDocuments } from "@/lib/applications/requirementDocuments";
import { guardAttempt } from "@/lib/agency/guards";

const NOT_FOUND = { error: "That requirement could not be found." };
const whole = (v: FormDataEntryValue | null | undefined) => {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : null;
};

/**
 * LA-3.18 · pages for a carrier requirement (the phone's scanned document, board E6b). Multipart:
 * `file` once per page (PNG, JPEG or PDF, 25 MB each, up to 20), optional `note` for underwriting, and
 * optional `page` / `pages` when a client sends a long document one page a request — the requirement
 * goes back to the carrier when the last one arrives. Stored privately beside the submission
 * confirmations; every page audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; requirementId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id, requirementId } = await params;
  if (!isUuid(id) || !isUuid(requirementId)) return NextResponse.json(NOT_FOUND, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardAttempt(auth.context, id);
  if (hidden) return hidden;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_CONFIRMATION_BYTES * MAX_REQUIREMENT_PAGES + 64 * 1024) return NextResponse.json({ error: "Those pages are too large to send at once.", code: "DOCUMENT_TOO_LARGE" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "Attach at least one page.", code: "invalid_request" }, { status: 400 });
  const note = form?.get("note");
  try {
    const result = await sendRequirementDocuments(actor, id, requirementId, {
      files, note: typeof note === "string" ? note.slice(0, 2000) : null, page: whole(form?.get("page")), pages: whole(form?.get("pages")),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
