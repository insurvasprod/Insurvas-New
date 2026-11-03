import { redirect } from "next/navigation";

import { TenantAuthWorkspace } from "@/components/app/tenant-auth-workspace";
import { googleSignInEnabled } from "@/lib/tenantAuth/google";
import { googleMessage } from "@/lib/tenantAuth/googleMessages";
import { resolveTenantSuspended } from "@/lib/tenantAuth/requireTenant";
import { getMaintenanceStatus } from "@/lib/system/service";

export const dynamic = "force-dynamic";

export default async function TenantLoginPage({ searchParams }: { searchParams: Promise<{ google?: string; step?: string }> }) {
  const query = await searchParams;
  const [maintenance, suspended, googleEnabled] = await Promise.all([
    getMaintenanceStatus().catch(() => null),
    // Every guard in the agent plane sends a refused session here. When the refusal is because the
    // agency is suspended, say that instead of offering a sign-in that would only refuse again.
    resolveTenantSuspended().catch(() => false),
    googleSignInEnabled(),
  ]);
  if (suspended) redirect("/app/suspended");

  return (
    <TenantAuthWorkspace
      maintenance={maintenance}
      googleEnabled={googleEnabled}
      initialStep={query.step === "code" ? "code" : undefined}
      notice={googleMessage(query.google)}
    />
  );
}
