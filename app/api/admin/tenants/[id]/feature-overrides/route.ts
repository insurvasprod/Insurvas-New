import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import {
  CAN_REMOVE_OVERRIDE,
  CAN_SWITCH_OFF,
  OVERRIDE_REASON_MAX,
  OVERRIDE_REASON_MIN,
  OVERRIDE_STATES,
  canSetOverride,
} from "@/lib/tenantFeatureOverrides/constants";
import { removeTenantFeatureOverride, setTenantFeatureOverride } from "@/lib/tenantFeatureOverrides/service";

// Per-tenant feature overrides (admin tenant record, "Feature overrides" tab).
//
//   PUT     set or replace one override   super_admin, support_agent (switching ON: super_admin only)
//   DELETE  remove one override           super_admin, support_agent
//
// billing_admin can read the tab but not change it. The database function re-checks the same rule,
// writes the row and rebuilds the tenant's entitlement in one transaction.

const reason = z
  .string()
  .trim()
  .min(OVERRIDE_REASON_MIN, `Give a reason of at least ${OVERRIDE_REASON_MIN} characters`)
  .max(OVERRIDE_REASON_MAX, `Keep the reason under ${OVERRIDE_REASON_MAX} characters`);

const putSchema = z.object({
  feature_key: z.string().trim().min(1, "Choose a feature"),
  state: z.enum(["on", "off"] satisfies typeof OVERRIDE_STATES[number][]),
  reason,
  review_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date for the review")
    .nullable()
    .default(null),
});

const deleteSchema = z.object({
  feature_key: z.string().trim().min(1, "Choose a feature"),
  reason,
});

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireAdminRole(CAN_SWITCH_OFF);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { feature_key, state, reason: why, review_on } = parsed.data;

  // Switching on a feature the plan lacks hands out something nobody is paying for.
  if (!canSetOverride(auth.session.role, state)) {
    return NextResponse.json(
      { error: "Only a super admin can switch on a feature the plan does not include." },
      { status: 403 },
    );
  }

  const result = await setTenantFeatureOverride({
    tenantId: id,
    featureKey: feature_key,
    state,
    reason: why,
    reviewOn: review_on,
    adminId: auth.session.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await audit({
    actorId: auth.session.sub,
    action: "tenant.feature_override_set",
    targetType: "tenant",
    targetId: id,
    reason: why,
    metadata: {
      feature_key,
      changes: {
        state: { from: result.before?.state ?? null, to: state },
        review_on: { from: result.before?.review_on ?? null, to: review_on },
      },
    },
    request,
  });

  return NextResponse.json({ ok: true, override: result.after });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireAdminRole(CAN_REMOVE_OVERRIDE);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { feature_key, reason: why } = parsed.data;

  const result = await removeTenantFeatureOverride({ tenantId: id, featureKey: feature_key, adminId: auth.session.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await audit({
    actorId: auth.session.sub,
    action: "tenant.feature_override_removed",
    targetType: "tenant",
    targetId: id,
    reason: why,
    metadata: {
      feature_key,
      removed: {
        state: result.before?.state ?? null,
        reason: result.before?.reason ?? null,
        set_at: result.before?.set_at ?? null,
      },
    },
    request,
  });

  return NextResponse.json({ ok: true });
}
