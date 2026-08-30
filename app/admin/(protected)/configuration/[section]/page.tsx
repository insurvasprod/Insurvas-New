import { forbidden, notFound } from "next/navigation";

import { ConfigurationPlaceholder } from "@/components/admin/configuration/configuration-placeholder";
import { OffersTable } from "@/components/admin/offers-table";
import { ProductsTable } from "@/components/admin/products-table";
import { TemplatesTable } from "@/components/admin/templates-table";
import { FeatureCatalog } from "@/components/admin/feature-catalog";
import { FeatureSwitchesPanel } from "@/components/admin/feature-switches-panel";
import { PaymentStatusPanel } from "@/components/admin/payment-status-panel";
import { SettingsForm } from "@/components/admin/settings-form";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import {
  accessibleConfigurationSections,
  canAccessConfigurationSection,
  getConfigurationSection,
} from "@/lib/configuration/sections";
import { ConfigurationSectionHeader } from "@/components/admin/configuration/section-header";
import { fetchFeatureCatalog, fetchFeatureModules } from "@/lib/features/queries";
import { fetchAllSwitches } from "@/lib/features/killSwitch";
import { getProviderStatus } from "@/lib/payments/status";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchSubscriptions } from "@/lib/subscriptions/queries";
import { fetchOffers } from "@/lib/offers/queries";
import { fetchProducts } from "@/lib/products/queries";
import { fetchTemplates } from "@/lib/templates/queries";
import { getAllSettings } from "@/lib/settings/queries";
import { ComplianceVendorsTable } from "@/components/admin/compliance-vendors-table";
import { listComplianceVendors } from "@/lib/compliance/service";
import { CreditLimitsPanel } from "@/components/admin/credit-limits-panel";
import { getCreditsLimitsData } from "@/lib/creditsLimits/service";
import { SystemSettingsPanel } from "@/components/admin/system-settings-panel";
import { getStoredMaintenance, listAnnouncements } from "@/lib/system/service";

export default async function ConfigurationSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) notFound();

  const { section: slug } = await params;
  const section = getConfigurationSection(slug);
  if (!section) notFound();
  if (!canAccessConfigurationSection(admin.role, section.slug)) forbidden();

  let content: React.ReactNode;
  if (section.slug === "payments") {
    const status = await getProviderStatus();
    content = <PaymentStatusPanel status={status} />;
  } else if (section.slug === "offers") {
    const [offers, plans, subscriptions] = await Promise.all([fetchOffers(), fetchPlans(), fetchSubscriptions()]);
    content = <OffersTable initialOffers={offers} plans={plans} subscriptions={subscriptions.filter((item) => item.status !== "cancelled")} />;
  } else if (section.slug === "products") {
    const products = await fetchProducts();
    content = <ProductsTable initialProducts={products} />;
  } else if (section.slug === "templates") {
    const [templates, products] = await Promise.all([fetchTemplates(), fetchProducts()]);
    content = <TemplatesTable initialTemplates={templates} products={products} />;
  } else if (section.slug === "advanced") {
    const settings = await getAllSettings();
    content = (
      <SettingsForm
        initial={settings.map((setting) => ({
          key: setting.def.key,
          value: setting.value,
          isOverridden: setting.isOverridden,
          updatedAt: setting.updatedAt,
        }))}
      />
    );
  } else if (section.slug === "features") {
    const [groups, modules, switches] = await Promise.all([
      fetchFeatureCatalog(),
      fetchFeatureModules(),
      fetchAllSwitches(),
    ]);

    // Archived features are excluded from the switch list: they are already unavailable to any new
    // plan, so a kill switch on one would be a control that changes nothing.
    const moduleLabels = new Map(modules.map((m) => [m.key, m.label]));
    const switchable = groups.flatMap((g) =>
      g.features
        .filter((f) => !f.is_archived)
        .map((f) => ({
          featureKey: f.feature_key,
          label: f.label,
          module: f.module,
          moduleLabel: moduleLabels.get(f.module) ?? f.module,
        })),
    );

    content = (
      <div className="space-y-8">
        <FeatureCatalog initialGroups={groups} modules={modules} />
        <div>
          <h2 className="mb-1 text-lg font-semibold tracking-tight">Kill switches</h2>
          <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
            Switching a feature off takes it away from every tenant immediately, whatever their plan
            says. This is not the same as a plan not including it &mdash; entitlements are untouched,
            and agents see a maintenance notice rather than an upgrade prompt.
          </p>
          <FeatureSwitchesPanel features={switchable} initialSwitches={[...switches.values()]} />
        </div>
      </div>
    );
  } else if (section.slug === "compliance-sources") {
    const vendors = await listComplianceVendors();
    content = <ComplianceVendorsTable initialVendors={vendors} />;
  } else if (section.slug === "credits-limits") {
    const data = await getCreditsLimitsData();
    content = <CreditLimitsPanel initialPacks={data.packs} initialPricing={data.pricing} initialMonitor={data.monitor} initialTenants={data.tenants} />;
  } else if (section.slug === "system") {
    const [maintenance, announcements] = await Promise.all([getStoredMaintenance(), listAnnouncements()]);
    content = <SystemSettingsPanel initialMaintenance={maintenance} initialAnnouncements={announcements} />;
  } else {
    content = <ConfigurationPlaceholder section={section} />;
  }

  return (
    <div>
      {/* Breadcrumb + section switcher replaces the back-link AND the 250px nav rail that used to
          sit beside every section. `section.owner` is deliberately not rendered: the registry keeps
          it for maintainers, but "Owned by SA-4.9" under a screen title is sprint bookkeeping, not
          something the person configuring the platform needs. */}
      <ConfigurationSectionHeader
        section={section}
        sections={accessibleConfigurationSections(admin.role)}
        title={section.label}
        description={section.description}
      />
      {content}
    </div>
  );
}
