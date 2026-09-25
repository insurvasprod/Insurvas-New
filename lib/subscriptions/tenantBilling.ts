import "server-only";

// Reads for the admin tenant record's "Subscription & billing" tab that no shared query answers.
// Each one is small and additive: the shared queries (subscriptions, invoices, plans) stay as they
// are, because other screens depend on their shape.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchPlanVersions } from "@/lib/plans/queries";
import { fetchPlanFeatureKeys } from "@/lib/plans/versionEditor";
import type { BillingCycle } from "@/lib/money";
import type { InvoiceStatus } from "@/lib/invoices/constants";

/** `plan_limits.max_seats` per plan. Missing plans are absent from the map; null means unlimited. */
export async function fetchPlanSeatLimits(planIds: string[]): Promise<Record<string, number | null>> {
  if (planIds.length === 0) return {};
  const { data, error } = await getSupabaseServiceClient()
    .from("plan_limits")
    .select("plan_id, max_seats")
    .in("plan_id", planIds);
  if (error) throw new Error(`Could not load plan seat limits: ${error.message}`);
  return Object.fromEntries(
    ((data ?? []) as { plan_id: string; max_seats: number | null }[]).map((row) => [row.plan_id, row.max_seats]),
  );
}

/** Seats the tenant holds, by the one seat rule the database applies (`tenant_seats_used`). */
export async function fetchTenantSeatsHeld(tenantId: string): Promise<number> {
  const { data, error } = await getSupabaseServiceClient().rpc("tenant_seats_used", { p_tenant_id: tenantId });
  if (error) throw new Error(`Could not count seats: ${error.message}`);
  return (data as unknown as number) ?? 0;
}

/**
 * The plan's monthly equivalent — the same `monthly_equivalent_cents` the revenue dashboard sums,
 * so the tenant record and the MRR chart can never disagree about one customer.
 */
export async function fetchMonthlyEquivalentCents(planId: string, cycle: BillingCycle): Promise<number> {
  const { data, error } = await getSupabaseServiceClient().rpc("monthly_equivalent_cents", {
    p_plan_id: planId,
    p_cycle: cycle,
  });
  if (error) throw new Error(`Could not work out MRR: ${error.message}`);
  return (data as unknown as number) ?? 0;
}

/* ── version pinning ───────────────────────────────────────────────────── */

export type VersionPinRow = {
  planId: string;
  version: number;
  /** When the version row was created — versions have no separate publish date. */
  liveFrom: string;
  /** Live (not cancelled) subscriptions on this exact version. */
  onIt: number;
  isArchived: boolean;
  isCurrent: boolean;
};

export type VersionMove = {
  fromVersion: number;
  toVersion: number;
  /** Feature labels the latest version grants that the tenant's version does not. */
  adds: string[];
  /** Feature labels the tenant's version grants that the latest version does not. */
  removes: string[];
};

export type VersionPinning = { rows: VersionPinRow[]; move: VersionMove | null };

/**
 * Every version of the tenant's plan, and — only when the tenant sits on an older version than the
 * latest sellable one — what moving them would add and take away, computed from `plan_features`.
 */
export async function fetchVersionPinning(planCode: string, currentPlanId: string): Promise<VersionPinning> {
  const versions = await fetchPlanVersions(planCode);
  const rows: VersionPinRow[] = versions.map((v) => ({
    planId: v.id,
    version: v.version,
    liveFrom: v.created_at,
    onIt: v.subscriber_count,
    isArchived: v.is_archived,
    isCurrent: v.id === currentPlanId,
  }));

  const latest = versions[0];
  const current = versions.find((v) => v.id === currentPlanId);
  // An archived latest version is not sold, so there is nothing to move anyone to.
  if (!latest || !current || latest.id === current.id || latest.is_archived || latest.version < current.version) {
    return { rows, move: null };
  }

  const [fromKeys, toKeys] = await Promise.all([fetchPlanFeatureKeys(current.id), fetchPlanFeatureKeys(latest.id)]);
  const addKeys = toKeys.filter((k) => !fromKeys.includes(k));
  const removeKeys = fromKeys.filter((k) => !toKeys.includes(k));
  const changed = [...addKeys, ...removeKeys];

  const labels = new Map<string, string>();
  if (changed.length > 0) {
    const { data } = await getSupabaseServiceClient().from("features").select("feature_key, label").in("feature_key", changed);
    for (const row of (data ?? []) as { feature_key: string; label: string }[]) labels.set(row.feature_key, row.label);
  }
  const label = (key: string) => labels.get(key) ?? key;

  return {
    rows,
    move: {
      fromVersion: current.version,
      toVersion: latest.version,
      adds: addKeys.map(label),
      removes: removeKeys.map(label),
    },
  };
}

/* ── invoices ──────────────────────────────────────────────────────────── */

export type TenantInvoiceRow = {
  id: string;
  number: string;
  status: InvoiceStatus;
  totalCents: number;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  /** Money returned to the card by refunds that went through. Credits and waivers are not refunds. */
  refundedCents: number;
};

/**
 * One tenant's invoices, newest number first, with what has actually been refunded against each.
 *
 * A separate function rather than a filter on the shared `fetchInvoices`: this one needs the period
 * and the refunds, and the invoices screen's shape is pinned by its own totals logic.
 */
export async function fetchTenantInvoiceRows(tenantId: string): Promise<TenantInvoiceRow[]> {
  const supabase = getSupabaseServiceClient();
  const [invoices, refunds] = await Promise.all([
    supabase
      .from("platform_invoices")
      .select("id, number, status, total_cents, period_start, period_end, paid_at")
      .eq("tenant_id", tenantId)
      .order("number", { ascending: false }),
    supabase
      .from("credit_notes")
      .select("invoice_id, amount_cents")
      .eq("tenant_id", tenantId)
      .eq("type", "refund")
      .eq("status", "succeeded")
      .not("invoice_id", "is", null),
  ]);

  // Both are checked. An empty list must mean "never billed", and a missing refund must not
  // present a partly refunded invoice as simply paid.
  if (invoices.error) throw new Error(`Could not load invoices: ${invoices.error.message}`);
  if (refunds.error) throw new Error(`Could not load refunds: ${refunds.error.message}`);

  const refundedByInvoice = new Map<string, number>();
  for (const row of (refunds.data ?? []) as { invoice_id: string; amount_cents: number }[]) {
    refundedByInvoice.set(row.invoice_id, (refundedByInvoice.get(row.invoice_id) ?? 0) + row.amount_cents);
  }

  type Raw = {
    id: string;
    number: string;
    status: InvoiceStatus;
    total_cents: number;
    period_start: string | null;
    period_end: string | null;
    paid_at: string | null;
  };
  return ((invoices.data ?? []) as Raw[]).map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    totalCents: row.total_cents,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    paidAt: row.paid_at,
    refundedCents: refundedByInvoice.get(row.id) ?? 0,
  }));
}
