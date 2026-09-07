import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { updateAffiliateLink } from "@/lib/affiliate/service";
import { affiliateLinkUpdateSchema } from "@/lib/affiliate/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const PARTNER_ROLES = ["owner", "bookkeeper"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId, linkId } = await params;
  const parsed = affiliateLinkUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "is_active must be true or false" }, { status: 400 });
  try {
    const link = await updateAffiliateLink(auth.context.tenantId, partnerId, linkId, parsed.data.is_active);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.affiliate_link_updated", targetType: "affiliate_link", targetId: link.id, reason: link.is_active ? "Affiliate link activated" : "Affiliate link paused", metadata: { partnerId, isActive: link.is_active }, request });
    return NextResponse.json({ link });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update affiliate link" }, { status: 400 }); }
}
