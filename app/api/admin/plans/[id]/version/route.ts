import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_PLANS } from "@/lib/plans/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { fetchPlanFeatureKeys } from "@/lib/plans/versionEditor";
import { rebuildEntitlementsForPlan } from "@/lib/entitlements/rebuild";

// Cents arrive as integers already — the browser does the dollars→cents conversion with the
// shared helper, so nothing here ever sees a decimal.
const centsField = z.number().int().min(0).max(100_000_000).nullable();

const savePlanVersionSchema = z.object({
  feature_keys: z.array(z.string().trim().min(1)).min(1, "A plan must grant at least one feature"),
  price_monthly_cents: centsField,
  price_quarterly_cents: centsField,
  price_yearly_cents: centsField,
  setup_fee_cents: z.number().int().min(0).max(100_000_000).default(0),
  trial_days: z.number().int().min(0).max(365).default(0),
});

/** Saves features AND pricing together, so one logical edit produces at most one new version. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = savePlanVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  // Captured before the write so the audit row can name what actually changed.
  const featuresBefore = await fetchPlanFeatureKeys(id);
  const { data: pricesBefore } = await supabase
    .from("plan_prices")
    .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days")
    .eq("plan_id", id)
    .maybeSingle();

  const { data, error } = await supabase.rpc("admin_save_plan_version", {
    p_plan_id: id,
    p_feature_keys: parsed.data.feature_keys,
    p_price_monthly: parsed.data.price_monthly_cents,
    p_price_quarterly: parsed.data.price_quarterly_cents,
    p_price_yearly: parsed.data.price_yearly_cents,
    p_setup_fee: parsed.data.setup_fee_cents,
    p_trial_days: parsed.data.trial_days,
  });

  if (error) {
    if (error.message?.includes("no_features")) {
      return NextResponse.json({ error: "A plan must grant at least one feature" }, { status: 400 });
    }
    if (error.message?.includes("plan_not_found")) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    if (error.code === "23503") {
      return NextResponse.json({ error: "One of those features doesn't exist" }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not save the plan" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  const featuresAfter = await fetchPlanFeatureKeys(result.target_plan_id);

  // Editing a plan in place changes what its existing subscribers get, so their cached
  // entitlements must be rebuilt. (A new version has no subscribers yet — theirs are untouched,
  // which is the whole point of versioning.)
  if (!result.created_new_version) {
    await rebuildEntitlementsForPlan(result.target_plan_id);
  }

  const added = featuresAfter.filter((k) => !featuresBefore.includes(k));
  const removed = featuresBefore.filter((k) => !featuresAfter.includes(k));

  // Price changes are audit-logged with old and new values (SA-2.4 acceptance criterion).
  const priceChanges: Record<string, { from: unknown; to: unknown }> = {};
  const priceFields = [
    ["price_monthly_cents", parsed.data.price_monthly_cents],
    ["price_quarterly_cents", parsed.data.price_quarterly_cents],
    ["price_yearly_cents", parsed.data.price_yearly_cents],
    ["setup_fee_cents", parsed.data.setup_fee_cents],
    ["trial_days", parsed.data.trial_days],
  ] as const;

  for (const [field, next] of priceFields) {
    const previous = (pricesBefore as Record<string, unknown> | null)?.[field] ?? null;
    if (previous !== next) priceChanges[field] = { from: previous, to: next };
  }

  const somethingChanged =
    added.length > 0 || removed.length > 0 || Object.keys(priceChanges).length > 0 || result.created_new_version;

  if (somethingChanged) {
    await audit({
      actorId: auth.session.sub,
      action: result.created_new_version ? "plan.version_created" : "plan.updated",
      targetType: "plan",
      targetId: result.target_plan_id,
      metadata: {
        features: { added, removed },
        prices: priceChanges,
        version: result.target_version,
        createdNewVersion: result.created_new_version,
        ...(result.created_new_version ? { supersededPlanId: id } : {}),
      },
      request,
    });
  }

  return NextResponse.json({
    planId: result.target_plan_id,
    version: result.target_version,
    createdNewVersion: result.created_new_version,
    featureKeys: featuresAfter,
  });
}
