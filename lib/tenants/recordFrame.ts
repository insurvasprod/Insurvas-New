import "server-only";
import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchTenantSubscription, type SubscriptionRow } from "@/lib/subscriptions/queries";
import { fetchTenantSeatCounts } from "@/lib/adminTenantUsers/queries";
import { seatLimitFor } from "@/lib/tenantTeam/seats";

/**
 * What the admin tenant record's frame shows above every tab: the header, the chip row and the
 * five-fact card. Read once per request (React `cache`), so the Overview tab — which shows the same
 * tenant, owner and subscription — asks again for free.
 *
 * Only the frame's own reads live here. Each tab fetches what it alone needs, so opening one tab
 * never pays for another.
 */
export type TenantRecordFrame = {
  tenant: {
    id: string;
    name: string;
    status: string;
    createdAt: string;
    suspendedAt: string | null;
    onboardingState: string;
    billingMode: string;
  };
  subscription: SubscriptionRow | null;
  owner: { name: string; email: string } | null;
  /**
   * By the one seat rule (lib/tenantTeam/seats.ts via fetchTenantSeatCounts, decision 3). `max` null =
   * no limit. `used` null = the members could not be read; `unavailable` then says why.
   */
  seats: { used: number | null; max: number | null; unavailable: string | null };
  /** The plan's monthly equivalent, as the revenue dashboard counts it; null when it could not be read. */
  mrrCents: number | null;
  /** False for a subscription the revenue dashboard does not count (trialing, paused, suspended). */
  mrrCounts: boolean;
};

/** Subscription states the revenue dashboard counts as MRR (compute_metrics_for_date). */
const REVENUE_BEARING = new Set(["active", "past_due", "cancelling"]);

export const fetchTenantRecordFrame = cache(async (tenantId: string): Promise<TenantRecordFrame | null> => {
  const supabase = getSupabaseServiceClient();

  // Everything the frame needs starts at once; only the plan's seat limit and MRR wait, and only on
  // the subscription they depend on.
  const tenantRead = Promise.resolve(
    supabase
      .from("tenants")
      .select("id, name, status, created_at, suspended_at, onboarding_state, billing_mode")
      .eq("id", tenantId)
      .maybeSingle<{
        id: string;
        name: string;
        status: string;
        created_at: string;
        suspended_at: string | null;
        onboarding_state: string;
        billing_mode: string;
      }>(),
  );
  const subscriptionRead = fetchTenantSubscription(tenantId);
  const rest = Promise.all([
    subscriptionRead,
    // Oldest accepted owner first; `maybeSingle` would throw on an agency with two owners.
    supabase
      .from("tenant_users")
      .select("accepted_at, users(name, email)")
      .eq("tenant_id", tenantId)
      .eq("role", "owner")
      .order("accepted_at", { ascending: true, nullsFirst: false })
      .limit(1),
    // The one seat rule, through the same helper as the Users & seats tab. A failure is reported as
    // "could not count", never as 0 seats, and does not take the rest of the record down with it.
    fetchTenantSeatCounts(tenantId).then(
      (counts) => ({ held: counts.held, error: null }),
      (error: unknown) => ({ held: null, error: error instanceof Error ? error.message : String(error) }),
    ),
    subscriptionRead.then((s) =>
      s
        ? Promise.all([
            supabase.from("plan_limits").select("max_seats").eq("plan_id", s.plan_id).maybeSingle<{ max_seats: number | null }>(),
            supabase.from("plans").select("plan_type").eq("id", s.plan_id).maybeSingle<{ plan_type: string | null }>(),
          ])
        : null,
    ),
    subscriptionRead.then((s) =>
      s
        ? Promise.resolve(supabase.rpc("monthly_equivalent_cents", { p_plan_id: s.plan_id, p_cycle: s.billing_cycle }))
        : null,
    ),
  ]);
  // Keeps a failure in `rest` from surfacing as an unhandled rejection when the tenant check below
  // returns first. Awaiting `rest` still throws as before.
  rest.catch(() => {});

  const { data: tenant, error } = await tenantRead;
  // "This tenant does not exist" and "we could not reach the database" must not be the same page.
  if (error) throw new Error(`Could not load this tenant: ${error.message}`);
  if (!tenant) return null;

  const [subscription, ownerRead, seatsRead, limitsRead, mrrRead] = await rest;

  const ownerRow = (ownerRead.data?.[0] ?? null) as { users: { name: string; email: string } | null } | null;
  const [limits, plan] = limitsRead ?? [null, null];
  const max = subscription ? seatLimitFor(limits?.data?.max_seats, plan?.data?.plan_type) : null;

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.created_at,
      suspendedAt: tenant.suspended_at,
      onboardingState: tenant.onboarding_state,
      billingMode: tenant.billing_mode,
    },
    subscription,
    owner: ownerRow?.users ?? null,
    seats: { used: seatsRead.held, max, unavailable: seatsRead.error },
    mrrCents: mrrRead && !mrrRead.error ? ((mrrRead.data as unknown as number) ?? 0) : null,
    mrrCounts: subscription ? REVENUE_BEARING.has(subscription.status) : false,
  };
});

/**
 * The most recent suspension of this agency as the audit log recorded it: when, by whom, and why.
 * Null when there is none, or when the log could not be read — the frame then shows the state
 * without the reason rather than failing the whole record.
 */
export const fetchLatestSuspension = cache(
  async (tenantId: string): Promise<{ ts: string; reason: string | null; actorName: string | null } | null> => {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("audit_log")
      .select("ts, reason, actor_id")
      .eq("action", "tenant.suspended")
      .eq("target_id", tenantId)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle<{ ts: string; reason: string | null; actor_id: string | null }>();
    if (error || !data) return null;
    let actorName: string | null = null;
    if (data.actor_id) {
      const { data: actor } = await supabase.from("admin_users").select("name").eq("id", data.actor_id).maybeSingle<{ name: string }>();
      actorName = actor?.name ?? null;
    }
    return { ts: data.ts, reason: data.reason, actorName };
  },
);
