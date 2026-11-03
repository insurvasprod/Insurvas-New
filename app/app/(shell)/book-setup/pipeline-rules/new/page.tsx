import { DataInPage } from "@/components/app/data-in/data-in-page";
import { RuleForm } from "@/components/app/book/setup/rule-form";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { Callout } from "@/components/app/settings/primitives";
import { StatusChip } from "@/components/ui/status-chip";
import { EVENT_LABELS, PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { loadBoard, loadCarrierChoices, loadRulesList } from "@/lib/pipelineRules/store";

/**
 * Book of business › Setup › Pipeline rules › New rule: the Rule tab of a rule not saved yet. Saving it
 * makes version 1, in forecast (owner decision 3): it records what it would do and moves nothing.
 */
export default async function NewPipelineRulePage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Pipeline rules" description="Rates, carrier rules and pipeline rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Pipeline rules" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const [view, board, carriers] = await Promise.all([loadRulesList(tenantId), loadBoard(tenantId), loadCarrierChoices(tenantId)]);
  const readOnly = guard.entitlement.access === "read_only";

  return (
    <DataInPage step="setup" title="New rule" lead={<span className="flex items-center gap-3 text-sm text-muted-foreground"><StatusChip tone="warning">Forecast</StatusChip>Starts in forecast · version 1</span>}>
      {!view.available ? (
        <Callout tone="warning" title={PIPELINE_RULES_PENDING_MESSAGE} />
      ) : (
        <>
          {readOnly && <Callout tone="warning" title="Book of business is read-only while the account is suspended." />}
          <RuleForm
            ruleId={null}
            readOnly={readOnly}
            board={board}
            carriers={carriers}
            initial={{ name: EVENT_LABELS.first_payment_missed.label, event: "first_payment_missed", carrierIds: [], fromStageIds: [], targetPipelineId: "", targetStageId: "", noteOn: true, noteTemplate: "First draft missed. Paid to {paid_to_date}, {days_past_due} days late. Carrier closes it in {days_left} days." }}
          />
        </>
      )}
    </DataInPage>
  );
}
