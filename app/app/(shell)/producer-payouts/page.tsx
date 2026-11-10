import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listTeamPlans } from "@/lib/agency/payPlanStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { ViewTabs } from "@/components/ui/view-tabs";
import { PayoutsBoard } from "@/components/app/agency/payouts-board";
import { PayPlansTable } from "@/components/app/agency/pay-plans";
import { PRODUCER_PAYOUTS_SLOT } from "@/components/app/agency/slots";

/**
 * AG-1.7 · Accounting › Producer payouts, reworked as Team payouts (owner's Accounting doc, round 1 boards T1–T6,
 * 2026-11-07; same address). Tabs on the title line: Run payroll (`?tab=` absent: month & team → draft →
 * confirm), Runs (`?tab=runs`, each row opens its private statement) and Pay plans (`?tab=plans`, who is paid
 * how; a row opens /app/producer-payouts/plans/<person>).
 */
export default async function ProducerPayoutsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Team payouts" description="Pay your team for the month." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Team payouts" detail="The owner, admins and the bookkeeper run payroll. Your own pay is under My pay." />;
  const [{ tab: asked }, money] = await Promise.all([searchParams, guardPage("profit_and_loss")]);
  const tab = asked === "runs" ? "runs" : asked === "plans" ? "plans" : "run";
  const readOnly = guard.entitlement.access === "read_only";
  // Void a run and write off a balance are LA-7.5's routes, behind Profit & loss for the bookkeepers (one producer-pay system, 2026-11-03).
  const moneyActions = money.entitled && actAsPage(money, ["owner", "bookkeeper"]) && !readOnly;
  const plans = tab === "plans" ? await listTeamPlans(guard.context.tenantId) : null;
  return (
    <AccountingPage
      step="producerPayouts"
      info="Pay your team for a month. Each person has a pay plan: solo or sidekick, salary + bonus, or a big split. Run payroll shows a draft first and saves nothing; anyone below zero gets your choice to carry it, take a share this month, or let it go. Confirm records how you paid each person, stamps the month paid and gives each a private statement. Nothing here moves money."
      tabs={<ViewTabs label="Team payouts" value={tab} tabs={[
        { key: "run", label: "Run payroll", href: "/app/producer-payouts" },
        { key: "runs", label: "Runs", href: "/app/producer-payouts?tab=runs" },
        { key: "plans", label: "Pay plans", count: plans && !plans.pending ? plans.team.filter((m) => !m.plan).length || undefined : undefined, href: "/app/producer-payouts?tab=plans" },
      ]} />}
      actions={<StepSlotTarget id={PRODUCER_PAYOUTS_SLOT} />}
    >
      {plans ? <PayPlansTable team={plans.team} pending={plans.pending} canEdit={!readOnly} /> : <PayoutsBoard tab={tab === "runs" ? "runs" : "run"} canCommit={!readOnly} moneyActions={moneyActions} />}
    </AccountingPage>
  );
}
