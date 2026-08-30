import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { forbidden, notFound } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { ConfigurationPlaceholder } from "@/components/admin/configuration/configuration-placeholder";
import { OffersTable } from "@/components/admin/offers-table";
import { ProductsTable } from "@/components/admin/products-table";
import { TemplatesTable } from "@/components/admin/templates-table";
import { FeatureCatalog } from "@/components/admin/feature-catalog";
import { PaymentStatusPanel } from "@/components/admin/payment-status-panel";
import { SettingsForm } from "@/components/admin/settings-form";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection, getConfigurationSection } from "@/lib/configuration/sections";
import { fetchFeatureCatalog, fetchFeatureModules } from "@/lib/features/queries";
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
    const [groups, modules] = await Promise.all([fetchFeatureCatalog(), fetchFeatureModules()]);
    content = <FeatureCatalog initialGroups={groups} modules={modules} />;
  } else if (section.slug === "compliance-sources") {
    const vendors = await listComplianceVendors();
    content = <ComplianceVendorsTable initialVendors={vendors} />;
  } else if (section.slug === "credits-limits") {
    const data = await getCreditsLimitsData();
    content = <CreditLimitsPanel initialPacks={data.packs} initialPricing={data.pricing} initialMonitor={data.monitor} initialTenants={data.tenants} />;
  } else {
    content = <ConfigurationPlaceholder section={section} />;
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/configuration"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" />
        Configuration Center
      </Link>
      <AdminPageHeader title={section.label} subtitle={`${section.description} Owned by ${section.owner}.`} />
      {content}
    </div>
  );
}
