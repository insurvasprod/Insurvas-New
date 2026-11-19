import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import { fetchActiveCoupon, fetchCoupons } from "@/lib/coupons/queries";
import { couponRejectionReason } from "@/lib/coupons/discount";
import { canManageCoupons } from "@/lib/coupons/permissions";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { formatCentsAsCurrency, priceForCycle, type BillingCycle } from "@/lib/money";
import { canManagePaymentProviders } from "@/lib/payments/permissions";
import { fetchTenantProviderRecord } from "@/lib/payments/registry";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchPricesForPlans } from "@/lib/plans/versionEditor";
import { fetchAddons, fetchAttachedAddons, fetchAvailableAddonIds } from "@/lib/addons/queries";
import { agencySeatSummary } from "@/lib/agency/adminSummary";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { fetchTenantSubscription } from "@/lib/subscriptions/queries";
import {
  fetchMonthlyEquivalentCents,
  fetchPlanSeatLimits,
  fetchTenantInvoiceRows,
  fetchTenantSeatsHeld,
  fetchVersionPinning,
} from "@/lib/subscriptions/tenantBilling";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { SubscriptionCardsProps } from "@/components/admin/tenant-record/subscription-cards";

/**
 * What a subscription's sheet on Admin › Subscriptions shows (billing-r2 screen 2), read on the server when the
 * address names it (`?open=<subscription id>`). The actions are the tenant record's own (SubscriptionCards,
 * AddonsPanel), so their data is gathered exactly as TenantSubscriptionTab gathers it, under the same permission
 * helpers its API routes check: a role never sees a control the server would refuse.
 */

export type SheetHistoryItem = { id: string; at: string; label: string; by: string | null; reason: string | null };
export type SheetNote = { id: string; at: string; body: string; by: string | null };

export type SubscriptionSheetData = {
  subscriptionId: string;
  tenant: { id: string; name: string };
  /** The tenant's live subscription the actions change; differs from `subscriptionId` only for an expired row. */
  liveSubscriptionId: string | null;
  cards: SubscriptionCardsProps | null;
  invoices: Awaited<ReturnType<typeof fetchTenantInvoiceRows>> | null;
  addons: { subscriptionId: string | null; subscriptionCycle: BillingCycle | null; attached: Awaited<ReturnType<typeof fetchAttachedAddons>>; catalog: Awaited<ReturnType<typeof fetchAddons>>; availableAddonIds: string[] } | null;
  coupon: { code: string; summary: string } | null;
  history: SheetHistoryItem[] | null;
  /** null: the notes table is not in this database yet (20261117410000 is a paste script, not applied). */
  notes: SheetNote[] | null;
  notesError: "missing" | "failed" | null;
  canNote: boolean;
};

type CouponLike = { code: string; discount_type: "percent" | "fixed"; percent_off: number | null; amount_off_cents: number | null };
const discountCopy = (c: CouponLike) => (c.discount_type === "percent" ? `${c.percent_off ?? 0}% off` : `${formatCentsAsCurrency(c.amount_off_cents ?? 0)} off`);

// subscription_billing_notes and audit_log are read loosely (not all in the generated types yet).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

const HISTORY_PREFIXES = ["subscription.", "trial.", "coupon.", "offer.", "invoice.", "credit_note.", "payment.", "tenant.billing_mode", "billing."];

async function readHistory(subscriptionId: string, tenantId: string, viewer: { id: string; role: AdminRole }): Promise<SheetHistoryItem[] | null> {
  // Rows that name the subscription, or the tenant (in the target or the metadata). The audit log's own rule
  // holds (lib/audit/logQuery.ts): only a super admin reads other staff members' actions.
  let query = db()
    .from("audit_log")
    .select("id, ts, actor_type, actor_id, action, reason")
    .or(`target_id.eq.${subscriptionId},target_id.eq.${tenantId},metadata->>tenantId.eq.${tenantId},metadata->>subscriptionId.eq.${subscriptionId}`)
    .order("ts", { ascending: false })
    .limit(60);
  if (viewer.role !== "super_admin") query = query.or(`actor_type.neq.admin,actor_id.eq.${viewer.id}`);
  const { data, error } = await query;
  if (error) {
    console.error("[admin/subscriptions] history read failed:", error.message);
    return null;
  }
  type Row = { id: string; ts: string; actor_type: string; actor_id: string | null; action: string; reason: string | null };
  const rows = ((data ?? []) as Row[]).filter((row) => HISTORY_PREFIXES.some((prefix) => row.action.startsWith(prefix)));
  const ids = [...new Set(rows.filter((row) => row.actor_type === "admin" && row.actor_id).map((row) => row.actor_id as string))];
  const admins = ids.length ? await db().from("admin_users").select("id, name").in("id", ids) : { data: [] };
  const names = new Map(((admins.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  return rows.map((row) => ({
    id: String(row.id),
    at: row.ts,
    label: (AUDIT_ACTION_LABELS as Record<string, string>)[row.action as AuditAction] ?? row.action,
    by: row.actor_type === "admin" ? (row.actor_id ? names.get(row.actor_id) ?? "An admin" : "An admin") : row.actor_type === "system" ? "System" : row.actor_type === "tenant" ? "The customer" : null,
    reason: row.reason,
  }));
}

async function readNotes(tenantId: string): Promise<{ notes: SheetNote[] | null; error: "missing" | "failed" | null }> {
  const { data, error } = await db()
    .from("subscription_billing_notes")
    .select("id, created_at, body, author_id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    if (isMissingRelation(error)) return { notes: null, error: "missing" };
    console.error("[admin/subscriptions] notes read failed:", error.message);
    return { notes: null, error: "failed" };
  }
  type Row = { id: string; created_at: string; body: string; author_id: string | null };
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((row) => row.author_id).filter((id): id is string => Boolean(id)))];
  const admins = ids.length ? await db().from("admin_users").select("id, name").in("id", ids) : { data: [] };
  const names = new Map(((admins.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  return { notes: rows.map((row) => ({ id: row.id, at: row.created_at, body: row.body, by: row.author_id ? names.get(row.author_id) ?? "An admin" : null })), error: null };
}

/** Null when the subscription does not exist. Throws when its own read fails (the sheet then says so). */
export async function fetchSubscriptionSheet(subscriptionId: string, viewer: { id: string; role: AdminRole }): Promise<SubscriptionSheetData | null> {
  const own = await db().from("subscriptions").select("id, tenant_id, tenants(name)").eq("id", subscriptionId).maybeSingle();
  if (own.error) throw new Error(`Could not load the subscription: ${own.error.message}`);
  if (!own.data) return null;
  const tenantId = own.data.tenant_id as string;
  const tenantName = (own.data.tenants as { name: string } | null)?.name ?? tenantId;

  const canManage = canManageSubscriptions(viewer.role);
  const canInvoices = canViewInvoices(viewer.role);
  const canPayments = canManagePaymentProviders(viewer.role);
  const canCoupons = canManageCoupons(viewer.role);

  const [subscription, plans, seatsHeld, invoices, providerRecord, billingMode, history, notes] = await Promise.all([
    fetchTenantSubscription(tenantId),
    canManage ? fetchPlans({ includeArchived: false }) : Promise.resolve([]),
    fetchTenantSeatsHeld(tenantId),
    canInvoices ? fetchTenantInvoiceRows(tenantId).catch(() => null) : Promise.resolve(null),
    canPayments ? fetchTenantProviderRecord(tenantId).catch(() => null) : Promise.resolve(null),
    canPayments ? db().from("tenants").select("billing_mode").eq("id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    readHistory(subscriptionId, tenantId, viewer),
    readNotes(tenantId),
  ]);

  const planIds = [...new Set([...plans.map((p) => p.id), ...(subscription ? [subscription.plan_id] : [])])];
  const [priceMap, seatLimits, mrrCents, pinning, addonCatalog, attachedAddons, availableAddonIds, activeCoupon, allCoupons] = await Promise.all([
    fetchPricesForPlans(planIds),
    fetchPlanSeatLimits(planIds),
    subscription ? fetchMonthlyEquivalentCents(subscription.plan_id, subscription.billing_cycle) : Promise.resolve(null),
    subscription?.plan_code ? fetchVersionPinning(subscription.plan_code, subscription.plan_id) : Promise.resolve(null),
    canManage ? fetchAddons({ activeOnly: true }) : Promise.resolve([]),
    canManage && subscription ? fetchAttachedAddons(subscription.id) : Promise.resolve([]),
    canManage && subscription ? fetchAvailableAddonIds(subscription.plan_id) : Promise.resolve([]),
    canCoupons && subscription ? fetchActiveCoupon(subscription.id) : Promise.resolve(null),
    canCoupons && subscription ? fetchCoupons() : Promise.resolve([]),
  ]);

  const couponOptions = subscription
    ? allCoupons
        .filter((c) => couponRejectionReason({ isActive: c.is_active, expiresAt: c.expires_at, maxRedemptions: c.max_redemptions, redeemedCount: c.redeemed_count }) === null && (c.billing_cycle === null || c.billing_cycle === subscription.billing_cycle))
        .map((c) => ({ id: c.id, label: `${c.code} — ${discountCopy(c)}` }))
    : [];
  const active = activeCoupon
    ? { code: activeCoupon.code, summary: `${discountCopy(activeCoupon)} · ${activeCoupon.periods_remaining === null ? "no end" : `${activeCoupon.periods_remaining} period${activeCoupon.periods_remaining === 1 ? "" : "s"} left`}` }
    : null;
  const mode = (billingMode as { data: { billing_mode?: string } | null }).data?.billing_mode === "manual" ? "manual" : "automatic";

  const cards: SubscriptionCardsProps = {
    tenantId,
    subscription,
    plans: plans.map((p) => ({ id: p.id, code: p.code, name: p.name, version: p.version, prices: priceMap.get(p.id) ?? null })),
    currentPriceCents: subscription ? priceForCycle(priceMap.get(subscription.plan_id) ?? null, subscription.billing_cycle) : null,
    seatLimits,
    seatsHeld,
    agency: subscription ? await agencySeatSummary(tenantId, seatLimits[subscription.plan_id]) : null,
    mrrCents,
    billing: canPayments ? { methodLabel: providerRecord?.payment_method_label ?? null, collection: mode } : null,
    pinning,
    coupons: canCoupons && subscription ? { options: couponOptions, active } : null,
    canManage,
  };

  return {
    subscriptionId,
    tenant: { id: tenantId, name: tenantName },
    liveSubscriptionId: subscription?.id ?? null,
    cards,
    invoices,
    addons: canManage ? { subscriptionId: subscription?.id ?? null, subscriptionCycle: subscription?.billing_cycle ?? null, attached: attachedAddons, catalog: addonCatalog, availableAddonIds } : null,
    coupon: active,
    history,
    notes: notes.notes,
    notesError: notes.error,
    canNote: canManage,
  };
}
