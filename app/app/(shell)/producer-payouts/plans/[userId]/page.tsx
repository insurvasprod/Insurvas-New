import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listTeamPlans } from "@/lib/agency/payPlanStore";
import { PAY_MODEL_LABELS } from "@/lib/agency/payPlanCore";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { PayPlanForm } from "@/components/app/agency/pay-plans";
import { PRODUCER_PAYOUTS_SLOT } from "@/components/app/agency/slots";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";

/** Team payouts › Pay plans › one person (round 1 board T2, 2026-11-07): a form page, never a side panel. */
export default async function PayPlanPage({ params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Team payouts" description="Pay your team for the month." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Team payouts" detail="The owner, admins and the bookkeeper set pay plans." />;
  const { userId } = await params;
  if (!isRecordId(userId)) notFound();
  const { team, pending } = await listTeamPlans(guard.context.tenantId);
  const member = team.find((m) => m.userId === userId);
  if (!member) notFound();
  return (
    <AccountingPage
      step="producerPayouts"
      title={`${member.name} · pay plan`}
      chip={<StatusChip tone={member.plan ? "info" : "neutral"}>{member.plan ? PAY_MODEL_LABELS[member.plan.model] : "Contract level"}</StatusChip>}
      facts={<>{member.plan ? `Paid this way since ${member.plan.effectiveFrom}` : "No plan yet: paid by contract level"}. A change applies from the date you choose; months already paid keep their plan.</>}
      actions={<StepSlotTarget id={PRODUCER_PAYOUTS_SLOT} />}
    >
      {pending ? <TableCard><EmptyState title="Pay plans are not switched on yet" hint="They need the Team payouts database update." /></TableCard> : <PayPlanForm member={member} readOnly={guard.entitlement.access === "read_only"} />}
    </AccountingPage>
  );
}
