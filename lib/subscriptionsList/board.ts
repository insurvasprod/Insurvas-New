import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import type { BillingCycle } from "@/lib/money";
import {
  compareRows,
  figuresFor,
  toListRow,
  type PlanPriceRow,
  type SubscriptionFigures,
  type SubscriptionListInput,
  type SubscriptionListRow,
} from "./model";

/**
 * Everything the admin Subscriptions page (board p-adm-subscriptions) shows, read on each request.
 *
 * Its own read rather than lib/subscriptions/queries.ts#fetchSubscriptions: this list also needs
 * the queued plan's version ("Scale v2 at renewal") and the moment access ended, and the shared
 * query's shape is used by other screens. Every subscription is loaded (hundreds, not thousands),
 * so the table's search, filters and paging are instant and the counts exact.
 */
export type SubscriptionsBoard = {
  rows: SubscriptionListRow[];
  figures: SubscriptionFigures;
  /** Plans the subscriptions are on, for the plan filter: "Growth v4". */
  plans: { id: string; label: string }[];
  /** The subscriptions could not be read — the page shows that, never an empty list. */
  listError: boolean;
};

type RawRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  pending_plan_id: string | null;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  started_at: string;
  tenants: { name: string } | null;
  plan: { code: string; name: string; version: number } | null;
  pending_plan: { name: string; version: number } | null;
};

// subscriptions has two FKs to plans, so each embed names its constraint (as queries.ts does).
const COLUMNS =
  "id, tenant_id, plan_id, pending_plan_id, status, billing_cycle, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, cancel_reason, cancelled_at, started_at, tenants(name), plan:plans!subscriptions_plan_id_fkey(code, name, version), pending_plan:plans!subscriptions_pending_plan_id_fkey(name, version)";

export async function fetchSubscriptionsBoard(now: Date = new Date()): Promise<SubscriptionsBoard> {
  const supabase = getSupabaseServiceClient();
  const [subsRead, pricesRead] = await Promise.all([
    supabase.from("subscriptions").select(COLUMNS).returns<RawRow[]>(),
    supabase.from("plan_prices").select("plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents"),
  ]);

  if (subsRead.error) {
    console.error("[admin/subscriptions] could not read subscriptions:", subsRead.error.message);
    return {
      rows: [],
      figures: figuresFor([], null, now),
      plans: [],
      listError: true,
    };
  }
  // A failed price read blanks the MRR tile and the per-row monthly figure; it must never print $0.
  if (pricesRead.error) console.error("[admin/subscriptions] could not read plan prices:", pricesRead.error.message);
  const prices = pricesRead.error ? null : ((pricesRead.data ?? []) as PlanPriceRow[]);

  const inputs: SubscriptionListInput[] = (subsRead.data ?? []).map(({ tenants, plan, pending_plan: pending, ...r }) => ({
    ...r,
    tenant_name: tenants?.name ?? null,
    plan_code: plan?.code ?? null,
    plan_name: plan?.name ?? null,
    plan_version: plan?.version ?? null,
    pending_plan_name: pending?.name ?? null,
    pending_plan_version: pending?.version ?? null,
  }));
  inputs.sort(compareRows);

  const priceBy = prices ? new Map(prices.map((p) => [p.plan_id, p])) : null;
  const plans = new Map<string, { id: string; label: string; name: string; version: number }>();
  for (const row of inputs) {
    if (plans.has(row.plan_id)) continue;
    const name = row.plan_name ?? "Unknown plan";
    const version = row.plan_version ?? 0;
    plans.set(row.plan_id, { id: row.plan_id, name, version, label: row.plan_version === null ? name : `${name} v${version}` });
  }

  return {
    rows: inputs.map((row) => toListRow(row, priceBy, now)),
    figures: figuresFor(inputs, prices, now),
    plans: [...plans.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version)
      .map(({ id, label }) => ({ id, label })),
    listError: false,
  };
}
