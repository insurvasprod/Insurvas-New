import { RuleForm, RuleFormActions } from "@/components/app/book/setup/rule-form";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RouteSheet } from "@/components/app/route-sheet";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { EmptyState } from "@/components/ui/page-states";
import { EVENT_LABELS, PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { loadBoard, loadCarrierChoices, loadRulesList } from "@/lib/pipelineRules/store";

const READ_ONLY = "Book of business is read-only while the account is suspended.";

/**
 * A new card-move rule, opened from inside the app: a panel from the right (route-sheet.tsx); the same gate as its page.
 * The rule's Save, on the page's title line there, sits in the footer here.
 */
export default async function NewPipelineRuleSheet() {
  const title = "New rule";
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <RouteSheet title={title} wide><FeatureGateNotice guard={guard} featureLabel="Card moves" description="Rates, carrier terms and card-move rules for your book." /></RouteSheet>;
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RouteSheet title={title} wide><RoleGateNotice featureLabel="Card moves" detail="Setup is for the account owner and bookkeepers." /></RouteSheet>;
  const tenantId = guard.context.tenantId;
  const [view, board, carriers] = await Promise.all([loadRulesList(tenantId), loadBoard(tenantId), loadCarrierChoices(tenantId)]);
  const readOnly = guard.entitlement.access === "read_only";
  return (
    <RouteSheet title={title} wide footer={view.available ? <div className="ml-auto flex items-center gap-2"><RuleFormActions readOnly={readOnly} reason={READ_ONLY} /></div> : undefined}>
      {!view.available ? (
        <EmptyState title="Card moves are not ready yet" hint={PIPELINE_RULES_PENDING_MESSAGE} />
      ) : (
        <RuleForm
          ruleId={null}
          readOnly={readOnly}
          board={board}
          carriers={carriers}
          initial={{ name: EVENT_LABELS.first_payment_missed.label, event: "first_payment_missed", carrierIds: [], fromStageIds: [], targetPipelineId: "", targetStageId: "", noteOn: true, noteTemplate: "First draft missed. Paid to {paid_to_date}, {days_past_due} days late. Carrier closes it in {days_left} days." }}
        />
      )}
    </RouteSheet>
  );
}
