import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { addAttachment, attachmentUrl, ComplaintError } from "@/lib/compliance/complaintStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * LA-6.4 (Notion sprint) · a complaint's files: the letter or carrier notice it arrived as, and what
 * was sent back. Stored privately; opened through a 60-second link.
 */
const ROLES = ["owner", "producer"] as const;
const isId = (id: string) => z.string().uuid().safeParse(id).success;

const fail = (error: unknown) => {
  if (error instanceof ComplaintError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[complaint-files]", error);
  return NextResponse.json({ error: "The file could not be handled" }, { status: 500 });
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Complaints");
  if (refused) return refused;
  const { id } = await params;
  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!isId(id) || !path) return NextResponse.json({ error: "That file isn't here." }, { status: 404 });
  const { tenantId, userId, role } = auth.context;
  try {
    return NextResponse.redirect(await attachmentUrl({ tenantId, userId, role }, id, path), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Complaints");
  if (refused) return refused;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That complaint isn't here." }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const side = form?.get("side") === "response" ? "response" : "complaint";
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  try {
    const complaint = await addAttachment({ tenantId, userId, role }, id, side, file);
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.complaint_updated", targetType: "complaint", targetId: id, metadata: { tenantId, attached: side, name: file.name.slice(0, 120) }, request });
    return NextResponse.json({ complaint });
  } catch (error) {
    return fail(error);
  }
}
