import { NextResponse, type NextRequest } from "next/server";

import { BusinessIdentityError, revealAgencyTaxId } from "@/lib/agencyProfile/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { secondFactorBlock } from "@/lib/tenantAuth/twoFactor";

/**
 * LA-8.3 · show the business tax ID in full, once. Owners only; every call writes one audit row
 * before the number is decrypted (lib/agencyProfile/service.ts). POST, not GET: a reveal is an act
 * that is recorded, and a GET could be prefetched or replayed from history.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  // LA-8.2: for a sole proprietor this number is an SSN.
  const blocked = await secondFactorBlock(auth.context);
  if (blocked) return blocked;
  try {
    const taxId = await revealAgencyTaxId(auth.context.tenantId, auth.context.userId, request);
    return NextResponse.json({ taxId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BusinessIdentityError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[agency-profile] tax ID reveal failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The tax ID could not be shown" }, { status: 500 });
  }
}
