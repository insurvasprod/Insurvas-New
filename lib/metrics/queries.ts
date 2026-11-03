import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { ONBOARDING_COMPLETE_STATES } from "@/lib/signup/constants";

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
  const { data, error } = await supabase
    .from("metrics_daily")
    .select("*")
    .gte("date", from)
    .order("date");

  // Check the error. Destructuring only `data` turns a failed query into an empty series, and the
  // revenue dashboard then renders a confident $0 MRR — which is indistinguishable from a business
  // with no customers. This is the screen where a silently wrong number is most expensive.
  if (error) throw new Error(`Could not load platform metrics: ${error.message}`);

  // `plan_breakdown` is a jsonb column, so the generated types call it `Json`. The shape is written
  // by `compute_metrics_for_date` and read only here; the cast goes through `unknown` because `Json`
  // and a keyed record genuinely do not overlap, and pretending otherwise hides the assumption.
  return (data as unknown as MetricsDay[] | null) ?? [];
}

export type SnapshotFreshness = {
  /** The newest snapshot date, or null when nothing has ever been computed. */
  date: string | null;
  /** Whole days between that snapshot and now. Null when there is no snapshot. */
  ageDays: number | null;
  /** More than a day behind, so the figures do not describe today. */
  isStale: boolean;
};

/**
 * How old the newest `metrics_daily` row is.
 *
 * Every figure on the revenue dashboard is read from that snapshot, which a nightly job writes. If
 * the job stops, the page keeps rendering the last numbers it managed to write — confidently, and
 * indistinguishably from today's. On 2026-09-21 the newest snapshot was 2026-09-11, so the
 * dashboard had been reporting ten-day-old revenue for a week and a half without saying so.
 *
 * SA-6.1 is the real fix — alert when a scheduled job stops running, not only when it fails — and
 * it is not built. Until it is, the screen can at least state the age of its own numbers.
 *
 * Lives here rather than in the page because `Date.now()` in a component body is impure and the
 * lint rule rightly refuses it; in an async server query it is simply the current time.
 */
export async function fetchSnapshotFreshness(): Promise<SnapshotFreshness> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("metrics_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle<{ date: string }>();

  if (error) throw new Error(`Could not read the metrics snapshot date: ${error.message}`);
  if (!data) return { date: null, ageDays: null, isStale: false };

  const ageDays = Math.floor((Date.now() - new Date(`${data.date}T00:00:00Z`).getTime()) / 86_400_000);
  return { date: data.date, ageDays, isStale: ageDays > 1 };
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
 * One of the ticket's six steps has nothing recording it: there is no profile concept. It is
 * returned as UNMEASURED rather than as zero — a silent gap reads as a cliff and sends someone
 * chasing a drop-off that does not exist.
 *
 * "Completed setup" used to be unmeasured too, on the stated grounds that `tenants.onboarding_state`
 * *"never advances from `not_started`"*. That was checked on 2026-09-22 and is false: across 586
 * tenants the column reads `complete` 383, `completed` 197, `ready_for_checkout` 5, `pending` 1 —
 * **not one `not_started`**. So the step is measurable and is now measured.
 *
 * It counts both spellings via `ONBOARDING_COMPLETE_STATES`. Matching only `completed` would have
 * reported 197 and drawn a 67% cliff at the last step that does not exist.
 */
export async function fetchFunnel(days = 90): Promise<FunnelStep[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const supabase = getSupabaseServiceClient();

  // Every step is filtered in the database via an inner join on `tenants`, rather than by reading
  // the tenant ids out and sending them back as an `.in()` list.
  //
  // The previous version did the latter, and it did not merely get slow — it stopped working. At
  // 542 tenants the id list made a URL long enough that the request died with `fetch failed` after
  // ~9 seconds, twice, and because the errors were destructured away the page then rendered a
  // funnel of zeros. `/admin/revenue` was the worst possible place for that: a dashboard whose
  // entire job is to say where customers are lost, quietly reporting that none were.
  //
  // Counting rows would be cheaper still (`head: true`), but a funnel step counts TENANTS, and one
  // tenant can own several subscriptions or several accepted invitations. So these select one
  // narrow column and de-duplicate. The payload is bounded by subscriptions and memberships, not
  // by tenants, and it travels in the response body where there is no length limit.
  const [signedUp, verified, started, completedSetup, activeAtDay30, day30Eligible] = await Promise.all([
    supabase.from("tenants").select("*", { count: "exact", head: true }).gte("created_at", since),

    // A member who has cleared verification. This used to require an ACCEPTED INVITATION, which
    // cannot capture the primary signup path: a self-serve owner (SA-5.1) creates their own
    // account and is never invited, so they could never reach this step. It reported 2 of 586
    // while 340 tenants had gone on to start a subscription — a funnel step that a later step
    // outran by two orders of magnitude, which is impossible and should have been the tell.
    //
    // `pending_verification` is the status that gates the blocking "check your email" screen, and
    // `invited` is an invitation not yet accepted; every other status means the person got past it.
    supabase
      .from("tenant_users")
      .select("tenant_id, tenants!inner(created_at), users!inner(status)")
      .gte("tenants.created_at", since)
      .not("users.status", "in", "(pending_verification,invited)"),

    supabase
      .from("subscriptions")
      .select("tenant_id, tenants!inner(created_at)")
      .gte("tenants.created_at", since),

    // A head count is right here where the other steps need de-duplication: this reads `tenants`
    // directly, so one row already is one tenant.
    supabase
      .from("tenants")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since)
      .in("onboarding_state", [...ONBOARDING_COMPLETE_STATES]),

    supabase
      .from("subscriptions")
      .select("tenant_id, tenants!inner(created_at)")
      .gte("tenants.created_at", since)
      // Only tenants old enough for the question to be answerable.
      .lte("tenants.created_at", thirtyDaysAgo)
      .in("status", ["active", "past_due", "cancelling"]),

    // How many tenants are even OLD ENOUGH to be asked. Without this the step cannot tell "nobody
    // survived to day 30" from "nobody has reached day 30 yet", and the two look identical on
    // screen: a count of 0.
    supabase
      .from("tenants")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since)
      .lte("created_at", thirtyDaysAgo),
  ]);

  for (const [label, result] of [
    ["signups", signedUp],
    ["verified emails", verified],
    ["started subscriptions", started],
    ["completed setup", completedSetup],
    ["day-30 retention", activeAtDay30],
    ["day-30 eligible population", day30Eligible],
  ] as const) {
    if (result.error) throw new Error(`Could not load the activation funnel (${label}): ${result.error.message}`);
  }

  const distinctTenants = (rows: { tenant_id: string }[] | null) =>
    new Set((rows ?? []).map((row) => row.tenant_id)).size;

  return [
    { label: "Signed up", count: signedUp.count ?? 0, measured: true },
    {
      label: "Verified email",
      count: distinctTenants(verified.data as { tenant_id: string }[] | null),
      measured: true,
      note: "Has a member past verification",
    },
    { label: "Completed profile", count: null, measured: false, note: "Nothing records a profile step" },
    {
      label: "Started subscription",
      count: distinctTenants(started.data as { tenant_id: string }[] | null),
      measured: true,
    },
    {
      label: "Completed setup",
      count: completedSetup.count ?? 0,
      measured: true,
      note: "Onboarding state is complete",
    },
    // A count of 0 here meant two completely different things and showed the same way. With no
    // tenant yet 30 days old, this read "0", and the drop-off sentence below then announced
    // "580 of 580 lost between Completed setup and Active at day 30 (100%)" — a total collapse
    // that had not happened, on the screen whose whole purpose is to locate real drop-off.
    // Measured in the live data on 2026-09-22: the oldest tenant was 15 days old, so the eligible
    // population was genuinely empty.
    day30Eligible.count
      ? {
          label: "Active at day 30",
          count: distinctTenants(activeAtDay30.data as { tenant_id: string }[] | null),
          measured: true,
          note: `Of ${day30Eligible.count} tenants older than 30 days`,
        }
      : {
          label: "Active at day 30",
          count: null,
          measured: false,
          note: "No tenant is 30 days old yet",
        },
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
