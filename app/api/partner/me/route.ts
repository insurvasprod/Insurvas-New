import { NextResponse } from "next/server";
import { partnerHasTeam, requirePartner } from "@/lib/partnerAuth/requirePartner";
import { readPartnerTopBarIdentity } from "@/lib/partnerAuth/topBarIdentity";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  // The phone app (2026-11-25) draws its tabs and home from these, as the portal's layout does from
  // the same context: the partner type and role pick the pages (lib/partnerAuth/portalAccess.ts), an
  // affiliate's team turns three more on, the home names the agency the partner sends to, and the
  // avatar the person signed in. All of it is the session's own person, partner and agency; a failed
  // read of an extra leaves it out, never wider.
  const [hasTeam, agency, person] = await Promise.all([
    context.partnerType === "affiliate" ? partnerHasTeam(context.tenantId, context.partnerId) : Promise.resolve(false),
    getSupabaseServiceClient().from("tenants").select("name").eq("id", context.tenantId).maybeSingle<{ name: string | null }>().then((r) => r.data?.name ?? null, () => null),
    readPartnerTopBarIdentity(context.userId).then((who) => who.name, () => null),
  ]);
  return NextResponse.json({
    userId: context.userId,
    name: person,
    partnerId: context.partnerId,
    partnerName: context.partnerName,
    role: context.role,
    partnerType: context.partnerType,
    partnerStatus: context.partnerStatus,
    hasTeam,
    agencyName: agency,
  }, { headers: { "Cache-Control": "no-store" } });
}
