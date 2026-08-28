import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageFeatures } from "@/lib/features/permissions";
import { fetchFeatureCatalog, fetchFeatureModules } from "@/lib/features/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { FeatureCatalog } from "@/components/admin/feature-catalog";

export default async function FeaturesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageFeatures(admin.role)) redirect("/admin");

  const [groups, modules] = await Promise.all([fetchFeatureCatalog(), fetchFeatureModules()]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Feature catalog"
        subtitle="Everything a subscription can switch on. Plans are built by ticking against this list."
      />
      <FeatureCatalog initialGroups={groups} modules={modules} />
    </div>
  );
}
