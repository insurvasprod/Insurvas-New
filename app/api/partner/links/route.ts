import { NextResponse } from "next/server";

import { listPartnerOwnLinks } from "@/lib/affiliate/partnerLinks";
import { requirePartnerPage } from "@/lib/partnerAuth/requirePartner";

/**
 * LA-1.8 · the affiliate's own tracked links (roles board P3, "My links"). Read-only, and only the
 * session's own: tenant and partner come from requirePartner's context, never from the request, so
 * another partner's links cannot be asked for. Affiliates only (lib/partnerAuth/portalAccess.ts); a
 * publisher or marketing partner is refused here, not just shown no menu item.
 *
 * Reading this never counts a click (only the public /affiliate route does).
 */
export async function GET() {
  // requirePartnerPage is requirePartner, then the type rule.
  const auth = await requirePartnerPage("links");
  if (auth instanceof NextResponse) return auth;
  try {
    const links = await listPartnerOwnLinks(auth.context.tenantId, auth.context.partnerId);
    return NextResponse.json({ links }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[partner-links]", error);
    return NextResponse.json({ error: "Your links could not be loaded" }, { status: 500 });
  }
}
