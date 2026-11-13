import { DataInPage } from "@/components/app/data-in/data-in-page";
import { RuleForm, RuleFormActions } from "@/components/app/book/setup/rule-form";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { EVENT_LABELS, PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { loadBoard, loadCarrierChoices, loadRulesList } from "@/lib/pipelineRules/store";

const READ_ONLY = "Book of business is read-only while the account is suspended.";

/**
 * Carrier sync › Card moves › New rule (mockup r7 2·3, its own page): the Rule tab of a rule not saved yet, the title
 * alone, Preview on today's data and Save rule on the title line. Saving it makes version 1, in forecast (owner
 * decision 3): it records what it would do and moves nothing — the form's last line says so.
 */
export default async function NewPipelineRulePage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Card moves" description="Rates, carrier terms and card-move rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Card moves" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const [view, board, carriers] = await Promise.all([loadRulesList(tenantId), loadBoard(tenantId), loadCarrierChoices(tenantId)]);
  const readOnly = guard.entitlement.access === "read_only";

  return (
    <DataInPage
      step="pipeline-rules"
      title="New rule"
      breadcrumbs={[{ label: "Carrier sync", href: "/app/needs-you" }, { label: "Card moves", href: "/app/book-setup/pipeline-rules" }, { label: "New rule" }]}
      actions={view.available ? <RuleFormActions readOnly={readOnly} reason={READ_ONLY} /> : undefined}
    >
      {!view.available ? (
        <TableCard><EmptyState title="Card moves are not ready yet" hint={PIPELINE_RULES_PENDING_MESSAGE} /></TableCard>
      ) : (
        <RuleForm
          ruleId={null}
          readOnly={readOnly}
          board={board}
          carriers={carriers}
          initial={{ name: EVENT_LABELS.first_payment_missed.label, event: "first_payment_missed", carrierIds: [], fromStageIds: [], targetPipelineId: "", targetStageId: "", noteOn: true, noteTemplate: "First draft missed. Paid to {paid_to_date}, {days_past_due} days late. Carrier closes it in {days_left} days." }}
        />
      )}
    </DataInPage>
  );
}
