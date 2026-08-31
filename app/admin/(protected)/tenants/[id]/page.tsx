import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewTenants } from "@/lib/tenants/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchTenantUsage } from "@/lib/metering/queries";
import { fetchTenantSubscription } from "@/lib/subscriptions/queries";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchPricesForPlans } from "@/lib/plans/versionEditor";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TenantUsagePanel } from "@/components/admin/tenant-usage-panel";
import { SubscriptionPanel } from "@/components/admin/subscription-panel";
import { AddonsPanel } from "@/components/admin/addons-panel";
import { fetchAddons, fetchAttachedAddons, fetchAvailableAddonIds } from "@/lib/addons/queries";
import { PaymentProviderPanel } from "@/components/admin/payment-provider-panel";
import { BillingModePanel } from "@/components/admin/billing-mode-panel";
import { canManagePaymentProviders } from "@/lib/payments/permissions";
import { fetchProviderSettings, fetchRecentProviderCalls } from "@/lib/payments/queries";
import { fetchTenantProviderRecord } from "@/lib/payments/registry";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewTenants(admin.role)) redirect("/admin");

  const { id } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, status, plan_code, onboarding_state, created_at, billing_mode")
    .eq("id", id)
    .maybeSingle();

  if (!tenant) notFound();

  const [usage, { data: owner }, subscription, plans] = await Promise.all([
    fetchTenantUsage(id),
    supabase
      .from("tenant_users")
      .select("users(name, email)")
      .eq("tenant_id", id)
      .eq("role", "owner")
      .maybeSingle<{ users: { name: string; email: string } | null }>(),
    fetchTenantSubscription(id),
    fetchPlans({ includeArchived: false }),
  ]);

  // Archived plans are excluded above, so they can't be newly sold — but anyone already on one
  // keeps working, which is the point of archiving rather than deleting.
  const priceMap = await fetchPricesForPlans(plans.map((p) => p.id));

  const [addonCatalog, attachedAddons, availableAddonIds] = await Promise.all([
    fetchAddons({ activeOnly: true }),
    subscription ? fetchAttachedAddons(subscription.id) : Promise.resolve([]),
    subscription ? fetchAvailableAddonIds(subscription.plan_id) : Promise.resolve([]),
  ]);
  const showPaymentProvider = canManagePaymentProviders(admin.role);
  const [providerRecord, providerSettings, providerCalls] = showPaymentProvider
    ? await Promise.all([fetchTenantProviderRecord(id), fetchProviderSettings(), fetchRecentProviderCalls(id)])
    : [null, [], []];

  const assignablePlans = plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    version: p.version,
    prices: priceMap.get(p.id) ?? null,
  }));

  const facts = [
    { label: "Owner", value: owner?.users ? `${owner.users.name} · ${owner.users.email}` : "—" },
    { label: "Plan", value: usage.planName ? `${usage.planName} v${usage.planVersion}` : "No subscription" },
    {
      label: "Seats",
      value: usage.maxSeats === null ? `${usage.seatsUsed} (unlimited)` : `${usage.seatsUsed} / ${usage.maxSeats}`,
    },
    { label: "Joined", value: new Date(tenant.created_at).toLocaleDateString() },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href="/admin/tenants"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to tenants
      </Link>

      <AdminPageHeader title={tenant.name} subtitle={`Tenant ${tenant.id}`} />

      <Card>
        <CardContent className="space-y-4">
          <Badge variant="outline" className="capitalize">
            {tenant.status}
          </Badge>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {facts.map(({ label, value }) => (
              <div key={label}>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-medium">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {canManageSubscriptions(admin.role) ? (
        <>
          <SubscriptionPanel tenantId={id} subscription={subscription} plans={assignablePlans} />
          <AddonsPanel
            subscriptionId={subscription?.id ?? null}
            subscriptionCycle={subscription?.billing_cycle ?? null}
            attached={attachedAddons}
            catalog={addonCatalog}
            availableAddonIds={availableAddonIds}
          />
        </>
      ) : (
        <Card>
          <CardContent>
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">Subscription</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {subscription
                ? `${subscription.plan_name} v${subscription.plan_version} · ${subscription.status}`
                : "No subscription."}
            </p>
          </CardContent>
        </Card>
      )}

      {showPaymentProvider && (
        <BillingModePanel tenantId={id} mode={tenant.billing_mode as "automatic" | "manual"} />
      )}

      {showPaymentProvider && (
        <PaymentProviderPanel
          tenantId={id}
          record={providerRecord}
          settings={providerSettings}
          calls={providerCalls}
          platformDefault={providerSettings.find((s) => s.is_default)?.display_label ?? null}
        />
      )}

      <TenantUsagePanel usage={usage} />
    </div>
  );
}
