import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_PLANS } from "@/lib/plans/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { fetchPlanFeatureKeys } from "@/lib/plans/versionEditor";
import { diffPlanMeters, planSaveErrorResponse, type PlanMeterInput } from "@/lib/plans/planSave";

// Cents arrive as integers already — the browser does the dollars→cents conversion with the
// shared helper, so nothing here ever sees a decimal.
const centsField = z.number().int().min(0).max(100_000_000).nullable();
const capacityField = z.number().int().min(0).max(1_000_000).nullable();

const LIMIT_KEYS = [
  "max_publishers",
  "max_marketing_partners",
  "max_affiliates",
  "max_buffer_seats",
  "max_partner_users",
  "max_setter_seats",
  "max_active_campaigns",
  "max_carriers",
] as const;

const savePlanVersionSchema = z.object({
  feature_keys: z.array(z.string().trim().min(1)).min(1, "A plan must grant at least one feature"),
  price_monthly_cents: centsField,
  price_quarterly_cents: centsField,
  price_yearly_cents: centsField,
  setup_fee_cents: z.number().int().min(0).max(100_000_000).default(0),
  trial_days: z.number().int().min(0).max(365).default(0),
  limits: z.object({
    max_publishers: capacityField,
    max_marketing_partners: capacityField,
    max_affiliates: capacityField,
    max_buffer_seats: capacityField,
    max_partner_users: capacityField,
    max_setter_seats: capacityField,
    max_active_campaigns: capacityField,
    // Optional so an older editor tab that does not send it leaves the plan's value alone.
    max_carriers: capacityField.optional(),
  }),
  /**
   * SA-2.5 · the plan's own meter allowances, the full list for this version. Absent = leave them
   * as they are; a meter left out of a list takes the platform default again.
   */
  meters: z
    .array(
      z.object({
        meter_key: z.string().trim().min(1).max(80),
        included_qty: z.number().int().min(0).max(1_000_000_000).nullable(),
        hard_cap: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
});

/**
 * Saves features, pricing, limits and meters together, so one logical edit produces at most one new
 * version — and in ONE database transaction (admin_save_plan_version_complete), with the subscribers'
 * entitlement rebuild inside it. It used to be three calls, and a failure after the first left a
 * published version carrying the old limits.
 */
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
  const loose = supabase as unknown as {
    from(table: string): { select(columns: string): { eq(column: string, value: string): { maybeSingle(): Promise<{ data: Record<string, unknown> | null }> } & Promise<{ data: Record<string, unknown>[] | null }> } };
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  };

  // Captured before the write so the audit row can name what actually changed.
  const featuresBefore = await fetchPlanFeatureKeys(id);
  const [{ data: pricesBefore }, { data: limitsBefore }, metersBefore] = await Promise.all([
    supabase
      .from("plan_prices")
      .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days")
      .eq("plan_id", id)
      .maybeSingle(),
    loose.from("plan_limits").select(LIMIT_KEYS.join(", ")).eq("plan_id", id).maybeSingle(),
    parsed.data.meters ? loose.from("plan_meters").select("meter_key, included_qty, hard_cap").eq("plan_id", id) : Promise.resolve({ data: null }),
  ]);

  // Only the keys sent are written; max_carriers is left alone when the editor did not send it.
  const limits: Record<string, number | null> = {};
  for (const key of LIMIT_KEYS) {
    const value = parsed.data.limits[key];
    if (value !== undefined) limits[key] = value;
  }

  const { data, error } = await loose.rpc("admin_save_plan_version_complete", {
    p_plan_id: id,
    p_feature_keys: parsed.data.feature_keys,
    p_price_monthly: parsed.data.price_monthly_cents,
    p_price_quarterly: parsed.data.price_quarterly_cents,
    p_price_yearly: parsed.data.price_yearly_cents,
    p_setup_fee: parsed.data.setup_fee_cents,
    p_trial_days: parsed.data.trial_days,
    p_limits: limits,
    p_meters: parsed.data.meters ?? null,
  });

  if (error) {
    const mapped = planSaveErrorResponse(error);
    if (mapped.status === 500) console.error("[plans] save failed", error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const result = (Array.isArray(data) ? data[0] : data) as {
    target_plan_id: string;
    target_version: number;
    created_new_version: boolean;
    refreshed_tenants: number;
  };
  const featuresAfter = await fetchPlanFeatureKeys(result.target_plan_id);

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

  const limitChanges: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, next] of Object.entries(limits)) {
    const previous = (limitsBefore as Record<string, unknown> | null)?.[key] ?? null;
    if (previous !== next) limitChanges[key] = { from: previous, to: next };
  }

  const meterChanges = parsed.data.meters
    ? diffPlanMeters(((metersBefore as { data: PlanMeterInput[] | null }).data ?? []) as PlanMeterInput[], parsed.data.meters)
    : {};

  const somethingChanged =
    added.length > 0 ||
    removed.length > 0 ||
    Object.keys(priceChanges).length > 0 ||
    Object.keys(limitChanges).length > 0 ||
    Object.keys(meterChanges).length > 0 ||
    result.created_new_version;

  if (somethingChanged) {
    await audit({
      actorId: auth.session.sub,
      action: result.created_new_version ? "plan.version_created" : "plan.updated",
      targetType: "plan",
      targetId: result.target_plan_id,
      metadata: {
        features: { added, removed },
        prices: priceChanges,
        limits: limitChanges,
        meters: meterChanges,
        version: result.target_version,
        createdNewVersion: result.created_new_version,
        refreshedTenants: result.refreshed_tenants,
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
