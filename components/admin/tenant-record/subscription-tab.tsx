import type { TenantTabProps } from "@/components/admin/tenant-record/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchTenantSubscription } from "@/lib/subscriptions/queries";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { canManagePaymentProviders } from "@/lib/payments/permissions";
import { canManageCoupons } from "@/lib/coupons/permissions";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchPricesForPlans } from "@/lib/plans/versionEditor";
import { fetchAddons, fetchAttachedAddons, fetchAvailableAddonIds } from "@/lib/addons/queries";
import { fetchProviderSettings, fetchRecentProviderCalls } from "@/lib/payments/queries";
import { fetchTenantProviderRecord } from "@/lib/payments/registry";
import { fetchActiveCoupon, fetchCoupons } from "@/lib/coupons/queries";
import { couponRejectionReason } from "@/lib/coupons/discount";
import { formatCentsAsCurrency, priceForCycle } from "@/lib/money";
import {
  fetchMonthlyEquivalentCents,
  fetchPlanSeatLimits,
  fetchTenantInvoiceRows,
  fetchTenantSeatsHeld,
  fetchVersionPinning,
} from "@/lib/subscriptions/tenantBilling";
import { AddonsPanel } from "@/components/admin/addons-panel";
import { BillingModePanel } from "@/components/admin/billing-mode-panel";
import { PaymentProviderPanel } from "@/components/admin/payment-provider-panel";
import { SubscriptionCards } from "./subscription-cards";
import { TenantInvoicesCard } from "./tenant-invoices-card";

type CouponLike = {
  code: string;
  discount_type: "percent" | "fixed";
  percent_off: number | null;
  amount_off_cents: number | null;
};

function discountCopy(c: CouponLike): string {
  return c.discount_type === "percent" ? `${c.percent_off ?? 0}% off` : `${formatCentsAsCurrency(c.amount_off_cents ?? 0)} off`;
}

/**
 * Subscription & billing tab (board p-adm-tenant-subscription).
 *
 * The two board cards and the invoices table first, then the controls the board does not draw but
 * the product already had on this record — add-ons, billing mode and the payment provider — so
 * nothing that could be done here before has gone. Every block is gated by the same permission
 * helper its API route uses, so a role never sees a control the server would refuse.
 */
export async function TenantSubscriptionTab({ tenantId, admin }: TenantTabProps) {
  const canManage = canManageSubscriptions(admin.role);
  const canInvoices = canViewInvoices(admin.role);
  const canPayments = canManagePaymentProviders(admin.role);
  const canCoupons = canManageCoupons(admin.role);
  const supabase = getSupabaseServiceClient();

  const tenantRead = Promise.resolve(
    supabase.from("tenants").select("id, name, billing_mode").eq("id", tenantId).maybeSingle<{
      id: string;
      name: string;
      billing_mode: string;
    }>(),
  );
  const subscriptionRead = fetchTenantSubscription(tenantId);
  // Only a role that can change the plan needs the catalogue. Archived plans are excluded: they
  // cannot be newly sold, though anyone already on one keeps it.
  const plansRead = canManage ? fetchPlans({ includeArchived: false }) : Promise.resolve([]);

  const [
    { data: tenant, error: tenantError },
    subscription,
    plans,
    seatsHeld,
    invoices,
    providerRecord,
    providerSettings,
    providerCalls,
  ] = await Promise.all([
    tenantRead,
    subscriptionRead,
    plansRead,
    fetchTenantSeatsHeld(tenantId),
    canInvoices ? fetchTenantInvoiceRows(tenantId) : Promise.resolve(null),
    canPayments ? fetchTenantProviderRecord(tenantId) : Promise.resolve(null),
    canPayments ? fetchProviderSettings() : Promise.resolve([]),
    canPayments ? fetchRecentProviderCalls(tenantId) : Promise.resolve([]),
  ]);
  if (tenantError) throw new Error(`Could not load this tenant: ${tenantError.message}`);
  if (!tenant) return null; // The page itself answers "no such tenant"; the tab has nothing to add.

  const planIds = [...new Set([...plans.map((p) => p.id), ...(subscription ? [subscription.plan_id] : [])])];

  const [priceMap, seatLimits, mrrCents, pinning, addonCatalog, attachedAddons, availableAddonIds, activeCoupon, allCoupons] =
    await Promise.all([
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

  const assignablePlans = plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    version: p.version,
    prices: priceMap.get(p.id) ?? null,
  }));

  const currentPriceCents = subscription
    ? priceForCycle(priceMap.get(subscription.plan_id) ?? null, subscription.billing_cycle)
    : null;

  // Only coupons the apply RPC would accept on grounds we can check here; a plan restriction is
  // still the RPC's to refuse, and its message is shown if it does.
  const couponOptions = subscription
    ? allCoupons
        .filter(
          (c) =>
            couponRejectionReason({
              isActive: c.is_active,
              expiresAt: c.expires_at,
              maxRedemptions: c.max_redemptions,
              redeemedCount: c.redeemed_count,
            }) === null &&
            (c.billing_cycle === null || c.billing_cycle === subscription.billing_cycle),
        )
        .map((c) => ({ id: c.id, label: `${c.code} — ${discountCopy(c)}` }))
    : [];

  const couponsProp =
    canCoupons && subscription
      ? {
          options: couponOptions,
          active: activeCoupon
            ? {
                code: activeCoupon.code,
                summary: `${discountCopy(activeCoupon)} · ${
                  activeCoupon.periods_remaining === null
                    ? "no end"
                    : `${activeCoupon.periods_remaining} period${activeCoupon.periods_remaining === 1 ? "" : "s"} left`
                }`,
              }
            : null,
        }
      : null;

  const billingMode = tenant.billing_mode === "manual" ? "manual" : "automatic";

  return (
    <div data-tenant-tab="subscription" className="flex w-full min-w-0 flex-col gap-6">
      <SubscriptionCards
        tenantId={tenantId}
        subscription={subscription}
        plans={assignablePlans}
        currentPriceCents={currentPriceCents}
        seatLimits={seatLimits}
        seatsHeld={seatsHeld}
        mrrCents={mrrCents}
        billing={canPayments ? { methodLabel: providerRecord?.payment_method_label ?? null, collection: billingMode } : null}
        pinning={pinning}
        coupons={couponsProp}
        canManage={canManage}
      />

      {invoices && <TenantInvoicesCard tenant={{ id: tenant.id, name: tenant.name }} invoices={invoices} />}

      {canManage && (
        <AddonsPanel
          subscriptionId={subscription?.id ?? null}
          subscriptionCycle={subscription?.billing_cycle ?? null}
          attached={attachedAddons}
          catalog={addonCatalog}
          availableAddonIds={availableAddonIds}
        />
      )}

      {canPayments && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <BillingModePanel tenantId={tenantId} mode={billingMode} />
          <PaymentProviderPanel
            tenantId={tenantId}
            record={providerRecord}
            settings={providerSettings}
            calls={providerCalls}
            platformDefault={providerSettings.find((s) => s.is_default)?.display_label ?? null}
          />
        </div>
      )}
    </div>
  );
}
