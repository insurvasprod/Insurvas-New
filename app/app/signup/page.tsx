import { TenantAuthWorkspace } from "@/components/app/tenant-auth-workspace";
import { fetchPublicPlans } from "@/lib/plans/public";
import { getMaintenanceStatus } from "@/lib/system/service";

export const dynamic = "force-dynamic";

export default async function TenantSignupPage() {
  const [plans, maintenance] = await Promise.all([
    fetchPublicPlans().catch(() => []),
    getMaintenanceStatus().catch(() => null),
  ]);

  return <TenantAuthWorkspace plans={plans} initialMode="sign-up" maintenance={maintenance} />;
}
