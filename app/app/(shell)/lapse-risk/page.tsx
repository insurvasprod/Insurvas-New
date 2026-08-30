import { guardPage } from "@/lib/entitlements/guardPage";
import { Card, CardContent } from "@/components/ui/card";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";

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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Lapse risk</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Policies most likely to lapse in the next 30 days.
        </p>
      </div>
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">Scaffolding for LA-0.1.</p>
        </CardContent>
      </Card>
    </div>
  );
}
