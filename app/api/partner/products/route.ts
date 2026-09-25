import { NextResponse } from "next/server";

import { listPartnerApprovedProducts } from "@/lib/partnerProducts/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ products: await listPartnerApprovedProducts(auth.context.tenantId, auth.context.partnerId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load approved products" }, { status: 500 });
  }
}
