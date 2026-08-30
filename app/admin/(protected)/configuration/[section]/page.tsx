import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { forbidden, notFound } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { ConfigurationPlaceholder } from "@/components/admin/configuration/configuration-placeholder";
import { CouponsTable } from "@/components/admin/coupons-table";
import { FeatureCatalog } from "@/components/admin/feature-catalog";
import { PaymentStatusPanel } from "@/components/admin/payment-status-panel";
import { SettingsForm } from "@/components/admin/settings-form";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { fetchCoupons } from "@/lib/coupons/queries";
import { canAccessConfigurationSection, getConfigurationSection } from "@/lib/configuration/sections";
import { fetchFeatureCatalog, fetchFeatureModules } from "@/lib/features/queries";
import { getProviderStatus } from "@/lib/payments/status";
import { getAllSettings } from "@/lib/settings/queries";

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
    content = <CouponsTable initialCoupons={await fetchCoupons()} />;
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
