import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { SubscriptionStatus } from "./access";
import type { BillingCycle } from "@/lib/money";

export type SubscriptionRow = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  plan_id: string;
  plan_code: string | null;
  plan_name: string | null;
  plan_version: number | null;
  pending_plan_id: string | null;
  pending_plan_name: string | null;
  /** The queued plan's version, so "Growth v4 → Scale v2" names the exact version being moved to. */
  pending_plan_version: number | null;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_reason: string | null;
  started_at: string;
};

type RawRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  pending_plan_id: string | null;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_reason: string | null;
  started_at: string;
  tenants: { name: string } | null;
  plan: { code: string; name: string; version: number } | null;
  pending_plan: { name: string; version: number } | null;
};

// Both plan joins are embedded rather than fetched in a second query. subscriptions has two FKs to
// plans, so each embed must name its constraint or PostgREST refuses the ambiguous join. Both
// constraints were checked against the live schema, not just the migrations.
const COLUMNS =
  "id, tenant_id, plan_id, pending_plan_id, status, billing_cycle, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, cancel_reason, started_at, tenants(name), plan:plans!subscriptions_plan_id_fkey(code, name, version), pending_plan:plans!subscriptions_pending_plan_id_fkey(name, version)";

/** Flattens the embedded plan names for both the current and any queued plan. */
function decorate(rows: RawRow[]): SubscriptionRow[] {
  return rows.map(({ plan, pending_plan: pending, ...r }) => {
    return {
      ...r,
      tenant_name: r.tenants?.name ?? null,
      plan_code: plan?.code ?? null,
      plan_name: plan?.name ?? null,
      plan_version: plan?.version ?? null,
      pending_plan_name: pending?.name ?? null,
      pending_plan_version: pending?.version ?? null,
    };
  });
}

export async function fetchSubscriptions(filters?: {
  status?: SubscriptionStatus;
  planId?: string;
}): Promise<SubscriptionRow[]> {
  const supabase = getSupabaseServiceClient();

  let request = supabase.from("subscriptions").select(COLUMNS).order("started_at", { ascending: false });
  if (filters?.status) request = request.eq("status", filters.status);
  if (filters?.planId) request = request.eq("plan_id", filters.planId);

  const { data, error } = await request.returns<RawRow[]>();
  if (error) throw new Error(`Could not load subscriptions: ${error.message}`);

  return decorate(data ?? []);
}

/** The tenant's live subscription, or null if nothing has been sold to them. */
export async function fetchTenantSubscription(tenantId: string): Promise<SubscriptionRow | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("subscriptions")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .order("started_at", { ascending: false })
    .limit(1)
    .returns<RawRow[]>();

  // "No subscription" is a real, meaningful state for a tenant, so it must not be something a
  // failed query can imitate.
  if (error) throw new Error(`Could not load the tenant subscription: ${error.message}`);

  const decorated = decorate(data ?? []);
  return decorated[0] ?? null;
}
