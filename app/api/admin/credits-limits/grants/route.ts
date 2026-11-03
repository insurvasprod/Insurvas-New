import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CREDIT_METER_KEYS } from "@/lib/creditsLimits/constants";
import { GrantRequestConflictError, grantCredits, hasAuditEntry } from "@/lib/creditsLimits/service";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";

const roles = ["super_admin", "platform_config"] as const;
const schema = z.object({
  // The dialog's request id, kept across retries of one grant. It becomes the grant's primary key, so
  // a retry after any failure returns the grant that already committed instead of making a second.
  request_id: z.string().uuid().optional(),
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
  const { request_id, ...input } = parsed.data;

  let grant: { id: string; replayed: boolean };
  try {
    grant = await grantCredits({ ...input, id: request_id, granted_by: auth.session.sub });
  } catch (error) {
    const status = error instanceof GrantRequestConflictError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not grant credits" }, { status });
  }

  // From here the grant has committed. Nothing below may turn that into an error the operator
  // answers by granting again.
  try {
    if (!grant.replayed || !(await hasAuditEntry("credit_grant.created", grant.id))) {
      await audit({ actorId: auth.session.sub, action: "credit_grant.created", targetType: "credit_grant", targetId: grant.id, reason: input.reason, metadata: { tenantId: input.tenant_id, meterKey: input.meter_key, quantity: input.quantity }, request });
    }
  } catch {
    return NextResponse.json(
      {
        error: "The credits were granted, but the audit entry could not be written. Retry — the same request will not grant twice.",
        grant: { id: grant.id },
        granted: true,
      },
      { status: 500 },
    );
  }

  // bugs_sa.md #12. Enforcement reads live SQL and already honours the grant; the agent's own usage
  // panel reads the cached entitlement. Best-effort after the audit: a failed rebuild used to return
  // 400 for a committed grant, and the natural retry granted the credits twice.
  let entitlementRefreshed = true;
  try {
    await rebuildEntitlement(input.tenant_id, "subscription.plan_changed");
  } catch {
    entitlementRefreshed = false;
  }

  return NextResponse.json(
    {
      grant: { id: grant.id },
      replayed: grant.replayed,
      entitlementRefreshed,
      ...(entitlementRefreshed ? {} : { warning: "Enforcement already counts these credits; the tenant's usage screen will catch up on its next refresh." }),
    },
    { status: grant.replayed ? 200 : 201 },
  );
}
