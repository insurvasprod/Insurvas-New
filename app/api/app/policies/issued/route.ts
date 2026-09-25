import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { IssuedPolicySchemaPendingError, listDealPolicies, markDealPolicyIssued } from "@/lib/issuedPolicies/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The policies recorded on one deal, and "Mark issued". Deal-flow's feature and roles: the owner
 * and producers who work deals are the ones who learn a policy was issued.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await listDealPolicies(auth.context.tenantId, request.nextUrl.searchParams.get("deal_id"));
    return NextResponse.json({ ...result, readOnly: auth.entitlement.access === "read_only" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the deal's policies" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const policy = await markDealPolicyIssued(auth.context.tenantId, { dealId: body?.deal_id, carrier: body?.carrier, policyNumber: body?.policy_number, issuedOn: body?.issued_on });
    // The policy number stays out of the audit metadata, as it stays out of every scorecard export.
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.policy_marked_issued", targetType: "tenant_issued_policy", targetId: policy.id, metadata: { deal_id: policy.deal_id, lead_id: policy.lead_id, campaign_id: policy.campaign_id, vendor_id: policy.vendor_id, carrier: policy.carrier, issued_at: policy.issued_at }, request });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (error) {
    if (error instanceof IssuedPolicySchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record the issued policy" }, { status: 400 });
  }
}
