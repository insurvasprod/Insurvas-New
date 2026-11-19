import { Suspense } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listTeamPlans } from "@/lib/agency/payPlanStore";
import { payoutPreview, producerRecordIds, readPayoutRules, readRuns } from "@/lib/agency/payoutStore";
import { previousMonth } from "@/lib/agency/payPlanCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { ViewTabs } from "@/components/ui/view-tabs";
import { StreamSection } from "@/components/ui/stream-section";
import { Part, startParts } from "@/components/app/commissions/frame-parts";
import { TableCard } from "@/components/ui/table-card";
import { ErrorState } from "@/components/ui/page-states";
import { PayMonthBoard, RunsBoard } from "@/components/app/commissions/team-payouts/team-payouts-board";
import { toPay } from "@/components/app/commissions/team-payouts/draft";
import { PayPlansTable } from "@/components/app/agency/pay-plans";
import { PRODUCER_PAYOUTS_SLOT } from "@/components/app/agency/slots";
import { monthName } from "@/components/app/commissions/team-payouts/shared";

/**
 * AG-1.7 · Commissions › Team payouts (round 7, owner pick 6·A, 2026-11-10; docs/la4/mockups-r7/commissions.html).
 * Moved from the Accounting rail; same address. The tabs on the title line: "Pay {Month}" (the month's job, the
 * tab you land on, with how many are to pay), Runs (`?tab=runs`, a row opens its statement) and Pay plans
 * (`?tab=plans`, a row opens the plan page). The month is a select on the title line, in the address
 * (`?period=YYYY-MM`). The draft is a plain table you read; a person's row opens their draft dialog; Confirm and
 * mark paid records how you paid, once, with a per-person change only where it differs.
 */
const today = () => new Date().toISOString().slice(0, 10);
const range = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
};

export default async function ProducerPayoutsPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string; month?: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Team payouts" description="Pay your team for the month." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Team payouts" detail="The owner, admins and the bookkeeper run payroll. Your own pay is under My pay." />;
  const [{ tab: asked, period, month: runsMonth }, money] = await Promise.all([searchParams, guardPage("profit_and_loss")]);
  const tab = asked === "runs" ? "runs" : asked === "plans" ? "plans" : "pay";
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  // Void a run and write off a balance are LA-7.5's routes, behind Profit & loss for the bookkeepers (one producer-pay system, 2026-11-03).
  const moneyActions = money.entitled && actAsPage(money, ["owner", "bookkeeper"]) && !readOnly;

  const chosen = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : null;
  const preview = async (month: string) => {
    const { from, to } = range(month);
    return payoutPreview(tenantId, from, to);
  };
  // The month you land on: last month, until everyone in it is paid; then this month ("Pay November").
  const pickMonth = async () => {
    if (chosen) return { month: chosen, rows: await preview(chosen) };
    const last = previousMonth(today());
    const rows = await preview(last);
    if (toPay(rows) > 0) return { month: last, rows };
    const now = today().slice(0, 7);
    return { month: now, rows: await preview(now) };
  };

  // The tabs on the title line; their counts (and, landing with no month asked, the month) once the reads land.
  const tabsOf = (month: string, counts: { pay: number | null; runs: number | null; plans: number | null } | null) => {
    const keep = `period=${month}`;
    return <ViewTabs label="Team payouts" value={tab} tabs={[
      { key: "pay", label: `Pay ${monthName(month)}`, count: counts?.pay ?? null, href: `/app/producer-payouts?${keep}` },
      { key: "runs", label: "Runs", count: counts?.runs ?? null, href: `/app/producer-payouts?tab=runs&${keep}` },
      { key: "plans", label: "Pay plans", count: counts?.plans ?? null, tone: "danger", href: `/app/producer-payouts?tab=plans&${keep}` },
    ]} />;
  };

  // Frame first (§7a): the title, the tabs and the slot for the month's button draw at once; the reads stream in under them.
  const view = startParts((async () => {
    const [picked, runs, plans, rules, records] = await Promise.all([
      pickMonth().catch((error: unknown) => ({ problem: error instanceof Error ? error.message : "The month could not be read." })),
      readRuns(tenantId, undefined, { includeVoid: true }).catch(() => null),
      listTeamPlans(tenantId).catch(() => null),
      readPayoutRules(tenantId).catch(() => ({ negativePolicy: "carry_forward", recoveryPctBp: 2000 })),
      producerRecordIds(tenantId).catch(() => new Map<string, string>()),
    ]);
    const draft = "problem" in picked ? null : picked;
    const problem = "problem" in picked ? picked.problem : null;
    const month = draft?.month ?? chosen ?? previousMonth(today());
    const names = Object.fromEntries([...(plans?.team ?? []).map((m) => [m.userId, m.name] as const), ...(draft?.rows ?? []).map((p) => [p.producerUserId, p.displayName] as const)]);
    const noPlan = plans && !plans.pending ? plans.team.filter((m) => !m.plan).length : 0;
    return {
      tabs: tabsOf(month, { pay: draft ? toPay(draft.rows) || null : null, runs: runs?.length ?? null, plans: noPlan || null }),
      body: tab === "plans" ? (plans ? <PayPlansTable team={plans.team} pending={plans.pending} /> : <TableCard><ErrorState detail="The pay plans could not be read. Reload to try again." /></TableCard>)
        : tab === "runs" ? (runs ? <RunsBoard runs={runs} names={names} payMonth={month} month={runsMonth && /^\d{4}-\d{2}$/.test(runsMonth) ? runsMonth : "all"} canCommit={!readOnly} /> : <TableCard><ErrorState detail="The runs could not be read. Reload to try again." /></TableCard>)
        : draft ? <PayMonthBoard key={month} month={month} preview={draft.rows} runs={(runs ?? []).filter((r) => r.periodStart.slice(0, 7) === month)} rules={rules} records={Object.fromEntries(records)} canCommit={!readOnly} moneyActions={moneyActions} />
        : <TableCard><ErrorState detail={problem ?? "The month could not be read. Reload to try again."} /></TableCard>,
    };
  })());

  return (
    <CommissionsPage
      step="teamPayouts"
      info="Pay your team for a month by each person's pay plan. Nothing is saved until you confirm, and nothing here moves money."
      tabs={<Suspense fallback={tabsOf(chosen ?? previousMonth(today()), null)}><Part read={view} part="tabs" /></Suspense>}
      actions={<StepSlotTarget id={PRODUCER_PAYOUTS_SLOT} />}
    >
      <StreamSection shape={tab === "pay" ? "strip+table" : "table"}><Part read={view} part="body" /></StreamSection>
    </CommissionsPage>
  );
}
