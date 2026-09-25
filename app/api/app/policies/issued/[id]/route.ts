import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { IssuedPolicySchemaPendingError, markIssuedPolicyLapsed } from "@/lib/issuedPolicies/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** "Mark lapsed": the policy stops counting as in force, and stops persisting from its lapse date. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.action !== "lapse") return NextResponse.json({ error: "Unsupported policy action" }, { status: 400 });
  try {
    const policy = await markIssuedPolicyLapsed(auth.context.tenantId, { policyId: (await params).id, lapsedOn: body.lapsed_on });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.policy_marked_lapsed", targetType: "tenant_issued_policy", targetId: policy.id, metadata: { deal_id: policy.deal_id, lead_id: policy.lead_id, campaign_id: policy.campaign_id, vendor_id: policy.vendor_id, issued_at: policy.issued_at, lapsed_at: policy.lapsed_at }, request });
    return NextResponse.json({ policy });
  } catch (error) {
    if (error instanceof IssuedPolicySchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not mark the policy lapsed" }, { status: 400 });
  }
}
