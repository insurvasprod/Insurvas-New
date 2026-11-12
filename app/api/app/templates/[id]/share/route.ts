import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { audit } from "@/lib/audit/log";
import { FormSchemaPendingError, readShare, saveShare, type ShareAudience } from "@/lib/templates/formsServer";

/** The Share sheet (board A7): the form's link, who can open it and its lead source. Needs 20261112200000. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    return NextResponse.json({ share: await readShare(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FormSchemaPendingError) return NextResponse.json({ share: null, code: "schema_pending", error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the share link" }, { status: 400 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { audience?: ShareAudience; source_label?: string; is_active?: boolean } | null;
  if (!body?.audience) return NextResponse.json({ error: "Choose who can open the link" }, { status: 400 });
  try {
    const { id } = await params;
    const share = await saveShare(auth.context.tenantId, auth.context.userId, id, { audience: body.audience, source_label: body.source_label ?? "", is_active: body.is_active !== false });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.form_definition_saved", targetType: "tenant_template", targetId: id, metadata: { change: "share_link", audience: share.audience, active: share.is_active }, request });
    return NextResponse.json({ share });
  } catch (error) {
    if (error instanceof FormSchemaPendingError) return NextResponse.json({ code: "schema_pending", error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the share link" }, { status: 400 });
  }
}
