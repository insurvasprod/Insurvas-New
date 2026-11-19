import { notFound, redirect } from "next/navigation";

import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchPlanVersionEditorData } from "@/lib/plans/versionEditor";
import { PlanVersionEditor } from "@/components/admin/plan-version-editor";

/**
 * The plan editor, its own page inside the Catalog frame (admin round 1, catalog.html screen 2): the title is the
 * plan, the trail Catalog › Plans › plan (the plan opens its sheet). Pricing, capacity, meters, the feature
 * checklists and the menu preview are unchanged; saving still publishes the next version when people are on this one.
 */
export default async function PlanVersionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManagePlans(admin.role)) redirect("/admin");

  const { id } = await params;
  const data = await fetchPlanVersionEditorData(id);
  if (!data) notFound();

  return (
    <CatalogPage
      step="plans"
      title={data.plan.name}
      breadcrumbs={[{ label: "Catalog", href: "/admin/catalog" }, { label: "Plans", href: "/admin/plans" }, { label: data.plan.name, href: `/admin/plans?plan=${data.plan.id}` }]}
      info="Price, limits and features for one version of this plan. Saving a version people are on publishes the next one; they keep the deal they bought."
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
        <PlanVersionEditor
          planId={data.plan.id}
          planName={data.plan.name}
          planCode={data.plan.code}
          planVersion={data.plan.version}
          isArchived={data.plan.is_archived}
          groups={data.groups}
          initialGranted={data.grantedKeys}
          initialPrices={data.prices}
          initialLimits={data.limits}
          subscriberCount={data.subscriberCount}
          nextVersion={data.nextVersion}
          meters={data.meters}
        />
      </div>
    </CatalogPage>
  );
}
