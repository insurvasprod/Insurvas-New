import { notFound, redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchPlanVersionEditorData } from "@/lib/plans/versionEditor";
import { PlanVersionEditor } from "@/components/admin/plan-version-editor";

export default async function PlanVersionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManagePlans(admin.role)) redirect("/admin");

  const { id } = await params;
  const data = await fetchPlanVersionEditorData(id);
  if (!data) notFound();

  return (
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
      />
    </div>
  );
}
