import { notFound, redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canSuspendTenants, canViewTenants } from "@/lib/tenants/permissions";
import { fetchLatestSuspension, fetchTenantRecordFrame } from "@/lib/tenants/recordFrame";
import { isTenantSuspended } from "@/lib/tenants/suspension";
import { tenantTabFrom } from "@/components/admin/tenant-record/types";
import { TenantRecordFrame } from "@/components/admin/tenant-record/frame";
import { TenantOverviewTab } from "@/components/admin/tenant-record/overview-tab";
import { TenantSubscriptionTab } from "@/components/admin/tenant-record/subscription-tab";
import { TenantUsersTab } from "@/components/admin/tenant-record/users-tab";
import { TenantFeaturesTab } from "@/components/admin/tenant-record/features-tab";
import { TenantActivityTab } from "@/components/admin/tenant-record/activity-tab";

/**
 * The admin tenant record: one frame (header, chips, facts, tab strip) and the active tab beneath
 * it. `?tab=` picks the tab; each tab is a server component that fetches only its own data, so the
 * frame's reads are the only ones every tab pays for.
 */
export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; page?: string | string[] }>;
}) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewTenants(admin.role)) redirect("/admin");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab = tenantTabFrom(query.tab);
  // Not a uuid is "no such tenant", not "the database failed" (which is what the query would say).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const frame = await fetchTenantRecordFrame(id);
  if (!frame) notFound();

  const suspension = isTenantSuspended(frame.tenant.status) ? await fetchLatestSuspension(id) : null;
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const page = Math.max(1, Math.floor(Number(rawPage)) || 1);

  const props = { tenantId: id, admin };

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <TenantRecordFrame
        frame={frame}
        activeTab={tab}
        canSuspend={canSuspendTenants(admin.role)}
        suspensionReason={suspension?.reason ?? null}
      />

      {tab === "overview" && <TenantOverviewTab {...props} />}
      {tab === "subscription" && <TenantSubscriptionTab {...props} />}
      {tab === "users" && <TenantUsersTab {...props} />}
      {tab === "features" && <TenantFeaturesTab {...props} />}
      {tab === "activity" && <TenantActivityTab {...props} page={page} />}
    </div>
  );
}
