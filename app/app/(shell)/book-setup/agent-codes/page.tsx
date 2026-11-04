import { DataInPage } from "@/components/app/data-in/data-in-page";
import { AgentCodes } from "@/components/app/book/setup/agent-codes";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { SetupTabs } from "@/components/app/book/setup/setup-tabs";
import { Callout } from "@/components/app/settings/primitives";
import { loadMatching, MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";

/**
 * Book of business › Setup › Agent codes (owner 2026-11-02, round 2): who each carrier's writing-agent
 * code credits. The same data and actions as Policy matching › Agent codes, which keeps working at
 * /app/policy-matching?tab=agents. Opening it writes nothing.
 */
export default async function SetupAgentCodesPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Agent codes" description="Rates, carrier rules and pipeline rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Agent codes" detail="Setup is for the account owner and bookkeepers." />;
  const view = await loadMatching(guard.context.tenantId);

  return (
    <DataInPage step="setup" lead={<SetupTabs active="agent-codes" tenantId={guard.context.tenantId} />}>
      {!view.available ? (
        <Callout tone="warning" title={MATCHING_PENDING_MESSAGE} />
      ) : (
        <AgentCodes unmapped={view.unmapped} mapped={view.mapped} members={view.members} carriers={view.carriers} readOnly={guard.entitlement.access === "read_only"} />
      )}
    </DataInPage>
  );
}
