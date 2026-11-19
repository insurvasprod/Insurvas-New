import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { readCatalogAudit, type CatalogAuditItem } from "@/lib/adminCatalog/audit";
import type { PlanLimits } from "@/lib/metering/constants";
import type { BillingCycle, PlanPrices } from "@/lib/money";
import type { PlanType } from "@/lib/plans/constants";
import { fetchSubscribersByVersion } from "@/lib/plans/listReads";
import { versionHistory, type DiffLine, type PlanMeterGrant, type PlanVersionSnapshot } from "@/lib/plans/versionDiff";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Viewer = { id: string; role: AdminRole };
type PlanRow = { id: string; code: string; version: number; name: string; is_archived: boolean; created_at: string };

const LIMIT_COLUMNS = "plan_id, max_seats, max_carriers, max_publishers, max_marketing_partners, max_affiliates, max_buffer_seats, max_partner_users, max_setter_seats, max_active_campaigns";
const PRICE_COLUMNS = "plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days, currency";

/** Feature and meter names, for diffs and the compare grid. */
export type PlanLabels = { features: Record<string, string>; meters: Record<string, string> };

async function labels(): Promise<PlanLabels> {
  const db = getSupabaseServiceClient();
  const [features, meters] = await Promise.all([db.from("features").select("feature_key, label"), db.from("meters").select("meter_key, label")]);
  return {
    features: Object.fromEntries((features.data ?? []).map((row) => [row.feature_key, row.label])),
    meters: Object.fromEntries((meters.data ?? []).map((row) => [row.meter_key, row.label])),
  };
}

/** The stored versions as snapshots: prices, limits, granted features, meter allowances and live subscribers. */
async function snapshots(rows: PlanRow[]): Promise<PlanVersionSnapshot[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const db = getSupabaseServiceClient();
  const [prices, limits, features, meters, subscribers] = await Promise.all([
    db.from("plan_prices").select(PRICE_COLUMNS).in("plan_id", ids),
    db.from("plan_limits").select(LIMIT_COLUMNS).in("plan_id", ids),
    db.from("plan_features").select("plan_id, feature_key").in("plan_id", ids),
    db.from("plan_meters").select("plan_id, meter_key, included_qty, hard_cap").in("plan_id", ids),
    fetchSubscribersByVersion(ids),
  ]);
  for (const read of [prices, limits, features, meters]) if (read.error) throw new Error(`Could not read the plan versions: ${read.error.message}`);
  const priceOf = new Map((prices.data ?? []).map((row) => [row.plan_id, row as unknown as PlanPrices]));
  // plan_limits' newer columns are not in the generated types yet (the editor reads them the same way).
  const limitOf = new Map(((limits.data ?? []) as unknown as Array<PlanLimits & { plan_id: string }>).map((row) => [row.plan_id, row as PlanLimits]));
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    name: row.name,
    createdAt: row.created_at,
    isArchived: row.is_archived,
    subscribers: subscribers[row.id] ?? 0,
    prices: priceOf.get(row.id) ?? null,
    limits: limitOf.get(row.id) ?? null,
    features: (features.data ?? []).filter((grant) => grant.plan_id === row.id).map((grant) => grant.feature_key),
    meters: (meters.data ?? []).filter((grant) => grant.plan_id === row.id).map((grant) => ({ meter_key: grant.meter_key, included_qty: grant.included_qty, hard_cap: grant.hard_cap }) as PlanMeterGrant),
  }));
}

export type PlanSheetSubscriber = {
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  version: number;
  status: string;
  cycle: BillingCycle | null;
  since: string | null;
};

export type PlanSheetPlan = {
  id: string;
  code: string;
  version: number;
  name: string;
  plan_type: PlanType;
  description: string | null;
  is_public: boolean;
  is_default: boolean;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
};

export type PlanSheetData = {
  planId: string;
  code: string;
  /** The version the sheet was opened on. */
  plan: PlanSheetPlan;
  versions: Array<PlanVersionSnapshot & { changes: DiffLine[] | null }>;
  /** Null when the subscriptions could not be read. */
  subscribers: PlanSheetSubscriber[] | null;
  /** Null when the audit log could not be read. */
  history: CatalogAuditItem[] | null;
};

/**
 * One plan's sheet (catalog.html screen 2): every version of its code with when it was published, how many are on
 * it and what changed against the one before; who is on it now and on which version; and its audit history. The
 * versions must read; the subscribers and the history each fail on their own.
 */
export async function fetchPlanSheet(planId: string, viewer: Viewer): Promise<PlanSheetData | null> {
  const db = getSupabaseServiceClient();
  const { data: plan, error } = await db.from("plans").select("id, code, version, name, plan_type, description, is_public, is_default, is_archived, sort_order, created_at").eq("id", planId).maybeSingle<PlanSheetPlan>();
  if (error) throw new Error(`Could not read the plan: ${error.message}`);
  if (!plan) return null;
  const { data: rows, error: versionsError } = await db.from("plans").select("id, code, version, name, is_archived, created_at").eq("code", plan.code).order("version", { ascending: false });
  if (versionsError) throw new Error(`Could not read the plan's versions: ${versionsError.message}`);
  const versionRows = (rows ?? []) as PlanRow[];
  const ids = versionRows.map((row) => row.id);
  const versionOf = new Map(versionRows.map((row) => [row.id, row.version]));

  const [stored, names, subscribers, history] = await Promise.all([
    snapshots(versionRows),
    labels(),
    (async (): Promise<PlanSheetSubscriber[] | null> => {
      const { data, error: subsError } = await db.from("subscriptions").select("id, tenant_id, plan_id, status, billing_cycle, created_at").in("plan_id", ids).neq("status", "cancelled").order("created_at", { ascending: false }).limit(500);
      if (subsError) {
        console.error("[admin/plans] subscribers read failed:", subsError.message);
        return null;
      }
      const subs = (data ?? []) as { id: string; tenant_id: string; plan_id: string; status: string; billing_cycle: BillingCycle | null; created_at: string | null }[];
      const tenantIds = [...new Set(subs.map((row) => row.tenant_id))];
      const tenants = tenantIds.length ? await db.from("tenants").select("id, name").in("id", tenantIds) : { data: [] as { id: string; name: string }[] };
      const tenantName = new Map((tenants.data ?? []).map((row) => [row.id, row.name]));
      return subs.map((row) => ({ subscriptionId: row.id, tenantId: row.tenant_id, tenantName: tenantName.get(row.tenant_id) ?? "Unnamed agency", version: versionOf.get(row.plan_id) ?? 0, status: row.status, cycle: row.billing_cycle, since: row.created_at }));
    })(),
    readCatalogAudit(viewer, { target: { type: "plan", ids } }, 60).catch((auditError: unknown) => {
      console.error("[admin/plans] history read failed:", auditError instanceof Error ? auditError.message : auditError);
      return null;
    }),
  ]);
  return { planId, code: plan.code, plan, versions: versionHistory(stored, names), subscribers, history };
}

export type PlanCompareData = { plans: PlanVersionSnapshot[]; labels: PlanLabels };

/** The latest version of each plan, side by side (Compare plans): price, limits, features and allowances. */
export async function fetchPlanCompare(latest: ReadonlyArray<PlanRow>): Promise<PlanCompareData> {
  const [plans, names] = await Promise.all([snapshots([...latest]), labels()]);
  return { plans, labels: names };
}
