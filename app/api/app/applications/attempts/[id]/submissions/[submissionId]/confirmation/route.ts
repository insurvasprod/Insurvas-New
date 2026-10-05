import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { MAX_CONFIRMATION_BYTES } from "@/lib/applications/afterSubmitRules";
import { attachConfirmation, confirmationUrl } from "@/lib/applications/confirmations";

const NOT_FOUND = { error: "That submission could not be found." };

/** LA-3.15 · a 60-second signed URL for the confirmation, after the tenant check (another agency's is a 403). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; submissionId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id, submissionId } = await params;
  if (!isUuid(id) || !isUuid(submissionId)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    return NextResponse.json(await confirmationUrl(actor.tenantId, id, submissionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

/** LA-3.15 · attach the confirmation (multipart `file`: PNG, JPEG or PDF, 10 MB) to private storage. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; submissionId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id, submissionId } = await params;
  if (!isUuid(id) || !isUuid(submissionId)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_CONFIRMATION_BYTES + 64 * 1024) return NextResponse.json({ error: "The confirmation must be 10 MB or smaller.", code: "CONFIRMATION_TOO_LARGE" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach the confirmation screenshot or PDF.", code: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json(await attachConfirmation(actor, id, submissionId, file), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
