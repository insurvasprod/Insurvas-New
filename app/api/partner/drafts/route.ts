import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { deletePartnerFormDraftById, listPartnerFormDrafts, loadPartnerFormDraftById } from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** LA-1.6-5: the signed-in partner user's started forms, newest first, across products. */
export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    const drafts = await listPartnerFormDrafts(auth.context.tenantId, auth.context.userId, auth.context.partnerId);
    return NextResponse.json({ drafts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load your drafts" }, { status: 500 });
  }
}

/** DELETE ?draft_id=<id> discards one of the caller's own drafts. */
export async function DELETE(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const draftId = request.nextUrl.searchParams.get("draft_id");
  if (!draftId || !UUID.test(draftId)) return NextResponse.json({ error: "That draft id is not valid" }, { status: 400 });
  try {
    const draft = await loadPartnerFormDraftById(auth.context.tenantId, auth.context.userId, auth.context.partnerId, draftId);
    if (!draft) return NextResponse.json({ error: "That draft was not found" }, { status: 404 });
    await deletePartnerFormDraftById(auth.context.tenantId, auth.context.userId, auth.context.partnerId, draftId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.form_draft_cleared", targetType: "form_draft", targetId: draftId, metadata: { partnerId: auth.context.partnerId, productCode: draft.product_code }, request });
    return NextResponse.json({ cleared: true });
  } catch {
    return NextResponse.json({ error: "Could not discard that draft" }, { status: 500 });
  }
}
