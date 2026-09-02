import { guardPage } from "@/lib/entitlements/guardPage";
import { Card, CardContent } from "@/components/ui/card";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";

/**
 * Gated on `chargeback_radar`, which only plan_c grants — so this is the page that demonstrates
 * the route guard doing something. A plan_a tenant pasting this URL gets an upgrade prompt
 * rather than a broken screen.
 */
export default async function LapseRiskPage() {
  const guard = await guardPage("chargeback_radar");

  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Lapse risk"
        description="Predictive scoring that flags policies likely to lapse before they do."
      />
    );
  }

  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Lapse risk" detail="Only owners and producers can view retention risk and commission exposure." />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Lapse risk</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Policies most likely to lapse in the next 30 days.
        </p>
      </div>
      <Card>
        <CardContent className="space-y-2 py-8 text-center">
          <p className="text-sm font-medium">Nothing at risk right now</p>
          <p className="mx-auto max-w-[46ch] text-sm text-muted-foreground">
            Policies scored as likely to lapse in the next 30 days will appear here, most urgent
            first.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
