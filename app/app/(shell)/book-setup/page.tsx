import { DataInPage } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RateCardWorkspace } from "@/components/app/rate-card";
import { Callout } from "@/components/app/settings/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { EXPECTED_PENDING_MESSAGE, loadRateCard } from "@/lib/ingestion/expectedCommissionStore";

const whole = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * Book of business › Setup (owner 2026-11-02, round 2): the rules the engine follows, one tab each — Rate
 * card (here), Carrier rules, Pipeline rules, Agent codes, Bring your existing book. The rate card is
 * today's screen (/app/rate-card keeps working), moved into Setup. Opening it writes nothing.
 */
export default async function BookSetupPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Setup" description="Rates, carrier terms and card-move rules for your book." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Setup" detail="Setup is for the account owner and bookkeepers." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Rate card" detail="Rates and contract levels are set by the account owner or a bookkeeper." />;
  const view = await loadRateCard(guard.context.tenantId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <DataInPage step="rate-card" chip={<InfoTip label="About the rate card" side="right">What each carrier pays you: your contract level and the commission rate per product. With a rate, Insurvas works out what every policy should pay and flags the payments that come in short. Work down the list: a carrier whose policies can&apos;t all be checked has <b>Add rates</b>; open it and add the rate for each product family.</InfoTip>}>
      {!view.available ? (
        <Callout tone="warning" title={EXPECTED_PENDING_MESSAGE} />
      ) : (
        <>
          {view.carriers.length > 0 && (
            <StatStrip label="Rate card coverage">
              <StatTile label="Carriers covered" value={`${view.coverage.carriersCovered} of ${view.coverage.carriers}`} footnote={view.coverage.carriersCovered < view.coverage.carriers ? <StatusChip tone="warning">{view.coverage.carriers - view.coverage.carriersCovered} not covered</StatusChip> : "with at least one policy they can price"} />
              <StatTile label="Premium covered" value={view.coverage.pricedPct === null ? "—" : `${view.coverage.pricedPct}%`} footnote={`${whole(view.coverage.pricedMonthlyCents)} of ${whole(view.coverage.totalMonthlyCents)} a month`} />
              <StatTile label="Expected so far" value={view.expected.available && view.expected.priced > 0 ? whole(view.expected.dueCents) : "—"} footnote={view.expected.available ? `${view.expected.priced.toLocaleString("en-US")} policies priced · ${view.expected.unpriced.toLocaleString("en-US")} without a rate` : "after the database update"} />
              <StatTile label="Past the usual lag" value={view.expected.available ? view.expected.pastLag.toLocaleString("en-US") : "—"} footnote="due by now; any still unpaid are in Discrepancies" />
            </StatStrip>
          )}
          <RateCardWorkspace carriers={view.carriers} products={view.products} readOnly={guard.entitlement.access === "read_only"} today={today} />
        </>
      )}
    </DataInPage>
  );
}
