import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { attachPdf, disclosureAttachmentUrl } from "@/lib/salesSettings/disclosures";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const notFound = () => NextResponse.json({ error: "That disclosure could not be found." }, { status: 404 });

/**
 * LA-3.10 · a disclosure's PDF, in the private application-confirmations bucket.
 * GET: a 60-second signed URL (owners and producers; tenant-scoped). POST: multipart `file`, a PDF of
 * at most 10 MB, attached to a draft (owners).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    return NextResponse.json(await disclosureAttachmentUrl(actorOf(auth, request), id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a PDF file.", code: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json({ item: await attachPdf(actorOf(auth, request), id, file) });
  } catch (error) {
    return failure(error);
  }
}
