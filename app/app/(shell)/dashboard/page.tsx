import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Always visible — the menu definition gives Dashboard no required_feature. */
export default async function AgentDashboardPage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const entitlement = await getEntitlement(context.tenantId);
  const meters = Object.entries(entitlement.meters);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {entitlement.plan_code
            ? `You're on ${entitlement.plan_code} (v${entitlement.plan_version}).`
            : "No active subscription."}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
            What your plan includes
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {entitlement.features.map((key) => (
              <Badge key={key} variant="outline" className="text-[10px]">
                {key}
              </Badge>
            ))}
            {entitlement.features.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {meters.length > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
              This period
            </h2>
            {meters.map(([key, meter]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span>{key}</span>
                <span className="text-muted-foreground">
                  {meter.used.toLocaleString("en-US")}
                  {meter.included === null ? " · unlimited" : ` / ${meter.included.toLocaleString("en-US")}`}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
