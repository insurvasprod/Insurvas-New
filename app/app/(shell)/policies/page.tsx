import { guardPage } from "@/lib/entitlements/guardPage";
import { Card, CardContent } from "@/components/ui/card";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";

/**
 * Scaffolding for LA-0.1 to replace — it exists so SA-2.8's three enforcement points are real
 * rather than theoretical.
 *
 * Deliberately gated on `book_of_business`, which every plan grants: a suspended tenant must
 * still be able to open this page. Suspend the doing, preserve the seeing.
 */
export default async function PoliciesPage() {
  const guard = await guardPage("book_of_business");

  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Book of business"
        description="Your policies, premiums and carriers in one place."
      />
    );
  }

  const readOnly = guard.entitlement.access === "read_only";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Policies</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">Your book of business.</p>
      </div>

      <Card>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No policies yet — this screen is scaffolding for LA-0.1.
          </p>
          {readOnly && (
            <p className="text-sm">
              You can read this while suspended. Adding a policy is disabled until the account is
              reactivated.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
