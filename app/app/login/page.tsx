import { redirect } from "next/navigation";

import { TenantAuthWorkspace } from "@/components/app/tenant-auth-workspace";
import { resolveTenantSuspended } from "@/lib/tenantAuth/requireTenant";
import { getMaintenanceStatus } from "@/lib/system/service";

export const dynamic = "force-dynamic";

export default async function TenantLoginPage() {
  const [maintenance, suspended] = await Promise.all([
    getMaintenanceStatus().catch(() => null),
    // Every guard in the agent plane sends a refused session here. When the refusal is because the
    // agency is suspended, say that instead of offering a sign-in that would only refuse again.
    resolveTenantSuspended().catch(() => false),
  ]);
  if (suspended) redirect("/app/suspended");

  return <TenantAuthWorkspace maintenance={maintenance} />;
}
