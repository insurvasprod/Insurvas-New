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
        <CardContent className="space-y-2 py-8 text-center">
          {/* An empty state that states a fact and stops is a dead end. This one says what will
              fill the screen and where it comes from — and it no longer quotes a ticket number at
              a paying customer, which is our vocabulary, not theirs. */}
          <p className="text-sm font-medium">No policies yet</p>
          <p className="mx-auto max-w-[46ch] text-sm text-muted-foreground">
            {readOnly
              ? "Your book of business will appear here. Adding a policy is disabled while the account is suspended."
              : "Your book of business will appear here once policies are imported or added."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
