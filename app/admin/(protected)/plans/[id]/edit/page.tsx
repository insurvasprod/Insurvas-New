import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchPlanVersionEditorData } from "@/lib/plans/versionEditor";
import { AdminPageHeader } from "@/components/admin/page-header";
import { PlanVersionEditor } from "@/components/admin/plan-version-editor";

export default async function PlanVersionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManagePlans(admin.role)) redirect("/admin");

  const { id } = await params;
  const data = await fetchPlanVersionEditorData(id);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href="/admin/plans"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to plans
      </Link>

      <AdminPageHeader
        title={`${data.plan.name} · v${data.plan.version}`}
        subtitle={`${data.plan.code} — features and pricing save together, so one edit produces at most one new version.`}
      />

      <PlanVersionEditor
        planId={data.plan.id}
        planVersion={data.plan.version}
        groups={data.groups}
        initialGranted={data.grantedKeys}
        initialPrices={data.prices}
        subscriberCount={data.subscriberCount}
      />
    </div>
  );
}
