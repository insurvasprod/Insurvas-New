import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type TrialRow = {
  subscription_id: string;
  tenant_id: string;
  tenant_name: string;
  plan_name: string;
  plan_code: string;
  billing_cycle: "monthly" | "quarterly" | "yearly";
  started_at: string;
  trial_ends_at: string;
  days_remaining: number;
  days_elapsed: number;
  owner_email: string | null;
  owner_name: string | null;
  last_login_at: string | null;
  has_payment_method: boolean;
  business_name: string | null;
};

/** Sorted by days remaining, as the ticket specifies — the ones about to end come first. */
export async function fetchTrials(): Promise<TrialRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("admin_trials_in_flight")
    .select("*")
    .order("days_remaining", { ascending: true });

  return (data as TrialRow[] | null) ?? [];
}

export type TrialStats = {
  activeTrials: number;
  convertedCount: number;
  expiredCount: number;
  conversionRate: number;
  averageDaysToConvert: number | null;
  /** The cut the ticket calls the one that tells you what to fix. */
  conversionByEngagement: { engaged: number; engagedConverted: number; dormant: number; dormantConverted: number };
};

/**
 * Trial-to-paid statistics.
 *
 * "Converted" means a subscription that had a trial_ends_at and is now active — a trial that
 * became a paying customer. Cancelled and suspended are counted as not converted, which is the
 * honest reading: they did not end up paying.
 */
export async function fetchTrialStats(): Promise<TrialStats> {
  const supabase = getSupabaseServiceClient();

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, status, started_at, trial_ends_at")
    .not("trial_ends_at", "is", null);

  const all = subs ?? [];
  const active = all.filter((s) => s.status === "trialing");
  const converted = all.filter((s) => s.status === "active" || s.status === "past_due" || s.status === "cancelling");
  const finished = all.filter((s) => s.status !== "trialing");

  const daysToConvert = converted
    .map((s) => (new Date(s.trial_ends_at!).getTime() - new Date(s.started_at).getTime()) / 86_400_000)
    .filter((d) => Number.isFinite(d) && d >= 0);

  // Engagement stands in for setup completion, which nothing records. Split on whether the owner
  // ever signed in — the cut that actually tells you something.
  const tenantIds = all.map((s) => s.tenant_id);
  const { data: owners } = tenantIds.length
    ? await supabase
        .from("tenant_users")
        .select("tenant_id, users(last_login_at)")
        .in("tenant_id", tenantIds)
        .eq("role", "owner")
    : { data: [] };

  const loggedIn = new Set(
    (owners ?? [])
      .filter((o) => (o.users as { last_login_at: string | null } | null)?.last_login_at)
      .map((o) => o.tenant_id),
  );

  const engagedAll = all.filter((s) => loggedIn.has(s.tenant_id));
  const dormantAll = all.filter((s) => !loggedIn.has(s.tenant_id));
  const isConverted = (s: { status: string }) =>
    s.status === "active" || s.status === "past_due" || s.status === "cancelling";

  return {
    activeTrials: active.length,
    convertedCount: converted.length,
    expiredCount: finished.length - converted.length,
    // Zero finished trials is 0%, not a division by zero.
    conversionRate: finished.length === 0 ? 0 : converted.length / finished.length,
    averageDaysToConvert:
      daysToConvert.length === 0
        ? null
        : Math.round((daysToConvert.reduce((a, b) => a + b, 0) / daysToConvert.length) * 10) / 10,
    conversionByEngagement: {
      engaged: engagedAll.length,
      engagedConverted: engagedAll.filter(isConverted).length,
      dormant: dormantAll.length,
      dormantConverted: dormantAll.filter(isConverted).length,
    },
  };
}
