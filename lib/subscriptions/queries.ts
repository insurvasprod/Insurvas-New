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
};

const COLUMNS =
  "id, tenant_id, plan_id, pending_plan_id, status, billing_cycle, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, cancel_reason, started_at, tenants(name)";

/** Joins plan names for both the current and any queued plan, in one extra query. */
async function decorate(rows: RawRow[]): Promise<SubscriptionRow[]> {
  if (rows.length === 0) return [];

  const supabase = getSupabaseServiceClient();
  const planIds = [
    ...new Set(rows.flatMap((r) => [r.plan_id, r.pending_plan_id]).filter((id): id is string => Boolean(id))),
  ];

  const { data: plans } = await supabase.from("plans").select("id, code, name, version").in("id", planIds);
  const planById = new Map((plans ?? []).map((p) => [p.id, p]));

  return rows.map((r) => {
    const plan = planById.get(r.plan_id);
    const pending = r.pending_plan_id ? planById.get(r.pending_plan_id) : null;
    return {
      ...r,
      tenant_name: r.tenants?.name ?? null,
      plan_code: plan?.code ?? null,
      plan_name: plan?.name ?? null,
      plan_version: plan?.version ?? null,
      pending_plan_name: pending?.name ?? null,
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

  const { data } = await supabase
    .from("subscriptions")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .order("started_at", { ascending: false })
    .limit(1)
    .returns<RawRow[]>();

  const decorated = await decorate(data ?? []);
  return decorated[0] ?? null;
}
