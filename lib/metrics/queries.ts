import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type MetricsDay = {
  date: string;
  mrr_cents: number;
  arr_cents: number;
  new_mrr_cents: number;
  expansion_mrr_cents: number;
  contraction_mrr_cents: number;
  churned_mrr_cents: number;
  collected_cents: number;
  active_customers: number;
  new_customers: number;
  churned_customers: number;
  trials_active: number;
  plan_breakdown: Record<string, { customers: number; mrr_cents: number }>;
};

export async function fetchMetrics(days = 30): Promise<MetricsDay[]> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("metrics_daily")
    .select("*")
    .gte("date", from)
    .order("date");

  return (data as MetricsDay[] | null) ?? [];
}

export type FunnelStep = {
  label: string;
  count: number | null;
  /** Null count means we do not record this step at all — distinct from a count of zero. */
  measured: boolean;
  note?: string;
};

/**
 * The activation funnel, derived from source tables.
 *
 * Two of the ticket's six steps have nothing recording them: there is no profile concept, and
 * `tenants.onboarding_state` never advances from `not_started`. They are returned as UNMEASURED
 * rather than as zero — a silent gap reads as a cliff and sends someone chasing a drop-off that
 * does not exist.
 */
export async function fetchFunnel(days = 90): Promise<FunnelStep[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const supabase = getSupabaseServiceClient();

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, created_at")
    .gte("created_at", since);

  const tenantIds = (tenants ?? []).map((t) => t.id);
  if (tenantIds.length === 0) {
    return [
      { label: "Signed up", count: 0, measured: true },
      { label: "Verified email", count: 0, measured: true },
      { label: "Completed profile", count: null, measured: false, note: "No profile step is recorded" },
      { label: "Started subscription", count: 0, measured: true },
      { label: "Completed setup", count: null, measured: false, note: "onboarding_state never advances" },
      { label: "Active at day 30", count: 0, measured: true },
    ];
  }

  const { data: links } = await supabase.from("tenant_users").select("tenant_id, user_id").in("tenant_id", tenantIds);
  const userIds = (links ?? []).map((l) => l.user_id);

  // An accepted invitation is the closest thing we have to a verified email: the user proved they
  // control the address by following the link and setting a password.
  const { data: accepted } = userIds.length
    ? await supabase
        .from("user_invitations")
        .select("user_id")
        .in("user_id", userIds)
        .eq("purpose", "invite")
        .not("accepted_at", "is", null)
    : { data: [] };

  const verifiedTenants = new Set(
    (links ?? [])
      .filter((l) => (accepted ?? []).some((a) => a.user_id === l.user_id))
      .map((l) => l.tenant_id),
  );

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("tenant_id, started_at, status")
    .in("tenant_id", tenantIds);

  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  const activeAtDay30 = (subs ?? []).filter((s) => {
    const tenant = (tenants ?? []).find((t) => t.id === s.tenant_id);
    if (!tenant) return false;
    // Only tenants old enough for the question to be answerable.
    if (new Date(tenant.created_at).getTime() > thirtyDaysAgo) return false;
    return ["active", "past_due", "cancelling"].includes(s.status);
  }).length;

  return [
    { label: "Signed up", count: tenantIds.length, measured: true },
    { label: "Verified email", count: verifiedTenants.size, measured: true, note: "Invitation accepted" },
    { label: "Completed profile", count: null, measured: false, note: "Nothing records a profile step" },
    { label: "Started subscription", count: (subs ?? []).length, measured: true },
    {
      label: "Completed setup",
      count: null,
      measured: false,
      note: "tenants.onboarding_state never advances past not_started",
    },
    { label: "Active at day 30", count: activeAtDay30, measured: true, note: "Tenants older than 30 days only" },
  ];
}

/**
 * The largest measured drop-off, stated in words.
 *
 * Unmeasured steps are skipped rather than treated as zero, which would always name them as the
 * biggest drop and make the sentence a lie.
 */
export function biggestDropOff(steps: FunnelStep[]): string {
  const measured = steps.filter((s) => s.measured && s.count !== null);
  let worst: { from: string; to: string; lost: number; rate: number } | null = null;

  for (let i = 1; i < measured.length; i++) {
    const before = measured[i - 1].count!;
    const after = measured[i].count!;
    const lost = before - after;
    if (lost <= 0 || before === 0) continue;
    const rate = lost / before;
    if (!worst || rate > worst.rate) {
      worst = { from: measured[i - 1].label, to: measured[i].label, lost, rate };
    }
  }

  if (!worst) return "No measured drop-off yet — not enough signups to see a pattern.";
  return `Biggest drop-off: ${worst.lost} of ${
    measured.find((s) => s.label === worst!.from)!.count
  } lost between “${worst.from}” and “${worst.to}” (${(worst.rate * 100).toFixed(0)}%).`;
}
