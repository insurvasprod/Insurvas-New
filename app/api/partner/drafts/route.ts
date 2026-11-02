import { NextResponse } from "next/server";

import { listPartnerFormDrafts, loadPartnerFormDraftById, summarizePartnerDraft } from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** LA-1.6-5: the signed-in partner user's started forms, newest first, across products. */
export async function GET(request: Request) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    const search = new URL(request.url).searchParams;
    const draftId = search.get("draft_id");
    if (draftId !== null) {
      if (!UUID.test(draftId)) return NextResponse.json({ error: "That draft id is not valid" }, { status: 400 });
      const draft = await loadPartnerFormDraftById(auth.context.tenantId, auth.context.userId, auth.context.partnerId, draftId);
      if (!draft) return NextResponse.json({ error: "That draft was not found" }, { status: 404 });
      return NextResponse.json({ drafts: [summarizePartnerDraft(draft)], total: 1, page: 1, pageSize: 20, pageCount: 1 }, { headers: { "Cache-Control": "no-store" } });
    }
    const page = Math.max(1, Math.min(100000, Number(search.get("page") || 1)));
    const pageSize = 20;
    const result = await listPartnerFormDrafts(auth.context.tenantId, auth.context.userId, auth.context.partnerId, page, pageSize);
    return NextResponse.json({ ...result, page, pageSize, pageCount: Math.max(1, Math.ceil(result.total / pageSize)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load your drafts" }, { status: 500 });
  }
}
