import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CREDIT_METER_KEYS } from "@/lib/creditsLimits/constants";
import { grantCredits } from "@/lib/creditsLimits/service";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";

const roles = ["super_admin", "platform_config"] as const;
const schema = z.object({
  tenant_id: z.string().uuid(),
  meter_key: z.enum(CREDIT_METER_KEYS),
  quantity: z.number().int().positive().max(1_000_000_000),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(roles);
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid credit grant" }, { status: 400 });
  try {
    const grant = await grantCredits({ ...parsed.data, granted_by: auth.session.sub });
    // bugs_sa.md #12. Enforcement reads live SQL and already honoured the grant, but the agent's
    // own usage panel reads the cached entitlement — so without this they were told they still had
    // the old allowance while actually holding the new one. "Immediately" has to mean both.
    await rebuildEntitlement(parsed.data.tenant_id, "subscription.plan_changed");
    await audit({ actorId: auth.session.sub, action: "credit_grant.created", targetType: "credit_grant", targetId: grant.id, reason: parsed.data.reason, metadata: { tenantId: parsed.data.tenant_id, meterKey: parsed.data.meter_key, quantity: parsed.data.quantity }, request });
    return NextResponse.json({ grant }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not grant credits" }, { status: 400 });
  }
}
