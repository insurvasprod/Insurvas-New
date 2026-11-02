import { DataInPage } from "@/components/app/data-in/data-in-page";
import { CarrierRulesEditor } from "@/components/app/book/setup/carrier-rules-editor";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { SetupTabs } from "@/components/app/book/setup/setup-tabs";
import { Callout } from "@/components/app/settings/primitives";
import { CARRIER_RULES_PENDING_MESSAGE } from "@/lib/ingestion/carrierRulesStore";
import { loadCarrierRuleSides } from "@/lib/pipelineRules/carrierRuleSides";

/**
 * Book of business › Setup › Carrier rules (owner decision 4, 2026-11-02): agencies may override a
 * carrier's rules. Each rule shows Insurvas's value and the agency's own; the agency's dated rule wins
 * from its date, and clearing it hands the rule back. The countdowns, the missed-payment events of the
 * pipeline rules and the expected commission all read these. Opening the page writes nothing.
 */
export default async function SetupCarrierRulesPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier rules" description="Rates, carrier rules and pipeline rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Carrier rules" detail="Setup is for the account owner and bookkeepers." />;
  const view = await loadCarrierRuleSides(guard.context.tenantId);
  const missing = view.carriers.filter((c) => c.inForce > 0 && (["first_payment", "ongoing_payment"] as const).some((type) => !c.rules[type].insurvas && !c.rules[type].yours)).length;

  return (
    <DataInPage step="setup" lead={<SetupTabs active="carrier-rules" counts={{ "carrier-rules": view.available ? missing : null }} />}>
      {!view.available ? (
        <Callout tone="warning" title={CARRIER_RULES_PENDING_MESSAGE} />
      ) : (
        <>
          {missing > 0 && (
            <Callout tone="warning" title={`${missing} ${missing === 1 ? "carrier you write with has" : "carriers you write with have"} no payment window or grace.`}>
              No missed-payment countdown or pipeline rule event is made for their policies until one is set: by Insurvas, or here as your own.
            </Callout>
          )}
          <CarrierRulesEditor carriers={view.carriers} asOf={view.asOf} readOnly={guard.entitlement.access === "read_only"} />
        </>
      )}
    </DataInPage>
  );
}
