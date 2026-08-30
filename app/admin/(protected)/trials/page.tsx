import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { fetchTrials, fetchTrialStats } from "@/lib/trials/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TrialsTable } from "@/components/admin/trials-table";
import { Card, CardContent } from "@/components/ui/card";

function percent(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export default async function TrialsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageSubscriptions(admin.role)) redirect("/admin");

  const [trials, stats] = await Promise.all([fetchTrials(), fetchTrialStats()]);
  const { conversionByEngagement: cut } = stats;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Trials"
        subtitle="Every trial in flight, soonest to end first — and whether it looks like converting"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "In flight", value: String(stats.activeTrials) },
          { label: "Converted", value: String(stats.convertedCount) },
          { label: "Expired without paying", value: String(stats.expiredCount) },
          { label: "Conversion rate", value: percent(stats.conversionRate) },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardContent>
              <p className="text-sm text-muted-foreground">{tile.label}</p>
              <p className="mt-1 text-2xl font-bold">{tile.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <TrialsTable trials={trials} />

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
            What separates the trials that convert
          </h2>

          {/*
            The ticket asks to correlate conversion with setup completion. Nothing records which
            setup steps a tenant has finished, so the closest measured thing is whether the owner
            ever signed in — which is labelled as exactly that rather than dressed up as setup
            progress. If step completion is ever recorded, this is the cut to replace.
          */}
          <dl className="space-y-1.5 text-sm">
            {[
              [
                "Owner signed in at least once",
                cut.engaged === 0 ? "—" : `${cut.engagedConverted}/${cut.engaged} converted`,
              ],
              [
                "Owner never signed in",
                cut.dormant === 0 ? "—" : `${cut.dormantConverted}/${cut.dormant} converted`,
              ],
              [
                "Average trial length before converting",
                stats.averageDaysToConvert === null ? "—" : `${stats.averageDaysToConvert} days`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="border-t border-border pt-2 text-xs text-muted-foreground">
            Engagement here means a recorded sign-in, not setup progress — no step completion is
            tracked anywhere yet, so a setup percentage would read the same for everybody.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
