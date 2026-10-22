import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RateCardWorkspace } from "@/components/app/rate-card";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { EXPECTED_PENDING_MESSAGE, loadRateCard } from "@/lib/ingestion/expectedCommissionStore";

const whole = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * Book of Business › Rate card (LA-4.13, Notion sprint): what each carrier should pay — your contract
 * level and its rates, by product family and age band — and how much of the book that covers. Owner
 * and bookkeeper. Opening the page writes nothing.
 */
export default async function RateCardPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Rate card" description="Know what every carrier should pay you." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Rate card" detail="Rates and contract levels are set by the account owner or a bookkeeper." />;
  const view = await loadRateCard(guard.context.tenantId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Rate card" description="Your commission rates for the carriers you write, so every payment can be checked against what it should have been." />
      {!view.available ? (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{EXPECTED_PENDING_MESSAGE}</div>
      ) : (
        <>
          {view.carriers.length > 0 && (
            <StatStrip label="Rate card coverage">
              <StatTile label="Carriers covered" value={`${view.coverage.carriersCovered} of ${view.coverage.carriers}`} footnote="with at least one policy they can price" valueTone={view.coverage.carriersCovered < view.coverage.carriers ? "warning" : undefined} />
              <StatTile label="Premium covered" value={view.coverage.pricedPct === null ? "—" : `${view.coverage.pricedPct}%`} footnote={`${whole(view.coverage.pricedMonthlyCents)} of ${whole(view.coverage.totalMonthlyCents)} a month`} />
              <StatTile label="Expected so far" value={view.expected.available && view.expected.priced > 0 ? whole(view.expected.dueCents) : "—"} footnote={view.expected.available ? `${view.expected.priced.toLocaleString("en-US")} policies priced · ${view.expected.unpriced.toLocaleString("en-US")} without a rate` : "after the database update"} />
              <StatTile label="Past the usual lag" value={view.expected.available ? view.expected.pastLag.toLocaleString("en-US") : "—"} footnote="due by now; any still unpaid are in Discrepancies" />
            </StatStrip>
          )}
          <RateCardWorkspace carriers={view.carriers} products={view.products} readOnly={guard.entitlement.access === "read_only"} today={today} />
        </>
      )}
    </div>
  );
}
