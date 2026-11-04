import { DataInPage } from "@/components/app/data-in/data-in-page";
import { CarrierCoverageList, type CoverageListRow } from "@/components/app/book/setup/carrier-coverage-list";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { SetupTabs } from "@/components/app/book/setup/setup-tabs";
import { Callout } from "@/components/app/settings/primitives";
import { RULE_TYPES } from "@/lib/ingestion/carrierRules";
import { CARRIER_RULES_PENDING_MESSAGE } from "@/lib/ingestion/carrierRulesStore";
import { loadCarrierCoverage } from "@/lib/pipelineRules/carrierCoverage";
import { filesSummary, missingOf, moneySummary, unverifiedOf } from "@/lib/pipelineRules/carrierCoverageModel";

/**
 * Book of business › Setup › Carrier rules (LA-4.17; board 9): the coverage screen. One row a carrier the agency
 * works with: its in-force policies, the five windows as dots (verified, observed but unverified, not set), the
 * biggest gap in words with the policies it leaves without a countdown, and its money and file facts in short.
 * Sorted by policies affected. Nothing is edited here: a row opens the carrier's page
 * (/app/book-setup/carrier-rules/[carrierId]). Null means null: a window nobody set reads "not set". Opening the
 * page writes nothing.
 */
export default async function SetupCarrierRulesPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier rules" description="Rates, carrier rules and pipeline rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Carrier rules" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const view = await loadCarrierCoverage(tenantId);

  const rows: CoverageListRow[] = view.carriers.map((carrier) => {
    const layout = carrier.layouts.find((l) => l.fileType === "commissions") ?? carrier.layouts[0] ?? null;
    const gap = carrier.gaps[0] ?? null;
    return {
      carrierId: carrier.carrierId,
      carrierName: carrier.carrierName,
      inForce: carrier.inForce,
      dots: Object.fromEntries(RULE_TYPES.map((type) => [type, carrier.rules[type].state])) as CoverageListRow["dots"],
      gap: gap ? { words: gap.words, cost: gap.cost } : null,
      missing: missingOf(carrier).length,
      unverified: unverifiedOf(carrier).length,
      money: moneySummary(carrier.settings.commissionTrigger.value as string | null, carrier.settings.expectedLagDays.value as number | null),
      files: filesSummary(carrier.settings.statementFormat.value as string | null, layout?.version ?? null),
    };
  });

  return (
    <DataInPage step="setup" lead={<SetupTabs active="carrier-rules" tenantId={tenantId} />}>
      {!view.available ? <Callout tone="warning" title={CARRIER_RULES_PENDING_MESSAGE} /> : <CarrierCoverageList rows={rows} />}
    </DataInPage>
  );
}
