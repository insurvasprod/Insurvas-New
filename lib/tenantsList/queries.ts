import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listStatus, type TenantListRow } from "./present";

/**
 * Every tenant with its owner and live plan, newest first, for the admin tenants list.
 *
 * Reads in pages of 1,000 because PostgREST caps a single response there: the old page asked once
 * and would have silently lost every tenant past the thousandth. Three independent reads run
 * together and are joined in memory.
 *
 * Plan comes from the live subscription, not `tenants.plan_code` — that column is null on every
 * row in the live database, so the old Plan column said "No plan yet" for tenants that were paying.
 */

const PAGE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

async function readAll<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>, what: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

type TenantRaw = {
  id: string;
  name: string;
  status: string;
  onboarding_state: string;
  created_at: string;
  suspended_at: string | null;
};

type OwnerRaw = { tenant_id: string; accepted_at: string | null; users: { name: string; email: string } | null };

type SubscriptionRaw = {
  tenant_id: string;
  status: string;
  trial_ends_at: string | null;
  started_at: string;
  plan: { name: string; version: number | null } | null;
};

export async function fetchTenantList(): Promise<TenantListRow[]> {
  const supabase = getSupabaseServiceClient();

  const [tenants, owners, subscriptions] = await Promise.all([
    readAll<TenantRaw>(
      (from, to) =>
        supabase
          .from("tenants")
          .select("id, name, status, onboarding_state, created_at, suspended_at")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
          .returns<TenantRaw[]>(),
      "tenants",
    ),
    readAll<OwnerRaw>(
      (from, to) =>
        supabase
          .from("tenant_users")
          .select("tenant_id, accepted_at, users(name, email)")
          .eq("role", "owner")
          .order("tenant_id", { ascending: true })
          .order("user_id", { ascending: true })
          .range(from, to)
          .returns<OwnerRaw[]>(),
      "tenant owners",
    ),
    // The same "live subscription" fetchTenantSubscription uses for the tenant record: not
    // cancelled, the most recently started one wins.
    readAll<SubscriptionRaw>(
      (from, to) =>
        supabase
          .from("subscriptions")
          .select("tenant_id, status, trial_ends_at, started_at, plan:plans!subscriptions_plan_id_fkey(name, version)")
          .neq("status", "cancelled")
          .order("started_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
          .returns<SubscriptionRaw[]>(),
      "subscriptions",
    ),
  ]);

  // Oldest accepted owner first, as the tenant record's frame picks it.
  const ownerByTenant = new Map<string, OwnerRaw>();
  for (const row of owners) {
    if (!row.users) continue;
    const held = ownerByTenant.get(row.tenant_id);
    if (!held || acceptedEarlier(row.accepted_at, held.accepted_at)) ownerByTenant.set(row.tenant_id, row);
  }

  // Ordered newest first, so the first one seen per tenant is the live one.
  const subscriptionByTenant = new Map<string, SubscriptionRaw>();
  for (const row of subscriptions) {
    if (!subscriptionByTenant.has(row.tenant_id)) subscriptionByTenant.set(row.tenant_id, row);
  }

  return tenants.map((tenant) => {
    const subscription = subscriptionByTenant.get(tenant.id) ?? null;
    return {
      id: tenant.id,
      name: tenant.name,
      tenantStatus: tenant.status,
      status: listStatus(tenant.status, subscription?.status ?? null),
      onboardingState: tenant.onboarding_state,
      createdAt: tenant.created_at,
      suspendedAt: tenant.suspended_at,
      owner: ownerByTenant.get(tenant.id)?.users ?? null,
      plan: subscription?.plan ? { name: subscription.plan.name, version: subscription.plan.version } : null,
      subscriptionStatus: subscription?.status ?? null,
      trialEndsAt: subscription?.trial_ends_at ?? null,
    };
  });
}

/** Earlier acceptance wins; an accepted owner beats one who never accepted. */
function acceptedEarlier(candidate: string | null, held: string | null): boolean {
  if (candidate === null) return false;
  if (held === null) return true;
  return new Date(candidate).getTime() < new Date(held).getTime();
}
