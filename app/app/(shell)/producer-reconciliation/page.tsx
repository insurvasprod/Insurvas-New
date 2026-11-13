import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { ReconciliationBoard, type ReconciliationView } from "@/components/app/agency/reconciliation-board";
import { ParamSelect } from "@/components/app/commissions/producer-pay/param-select";
import { monthLabel, monthName, monthRange, parsePeriod, periodOptions, planShort } from "@/components/app/commissions/producer-pay/period";
import { READ_ONLY_REASON } from "@/components/app/commissions/producer-pay/review-dialog";
import { Button } from "@/components/ui/button";
import { ViewTabs } from "@/components/ui/view-tabs";
import { producerPayFigures, type ProducerPayFigure } from "@/lib/commissions/producerPayFigures";
import { readMonthPayouts, readThreeTruths } from "@/lib/agency/moneyStores";
import { readRoster } from "@/lib/agency/producerStore";
import { listTeamPlans } from "@/lib/agency/payPlanStore";

/** A difference over this opens a review item (the reconciliation API's own default, AG-1.12). */
const REVIEW_THRESHOLD_CENTS = 5000;
const HREF = "/app/producer-reconciliation";
const VIEWS: ReconciliationView[] = ["pay", "truths", "review"];

/**
 * AG-1.12 · Commissions › Producer pay. The owner, an admin or the bookkeeper.
 *
 * Round 7, direction A (owner 2026-11-10, docs/la4/mockups-r7/commissions.html 4·A): the month, then the person.
 * Pay · Three truths · To review are the title line's tabs (?view=) and the month is a select beside the buttons
 * (?period=YYYY-MM, last month by default), so both survive Back and can be sent as a link. "Pay {Month}" opens Team
 * payouts for the same month (one name for the job; the old title-line button is gone). Every figure is read here, once.
 */
export default async function ProducerReconciliationPage({ searchParams }: { searchParams: Promise<{ view?: string; period?: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer pay" description="Expected, reported and received, per producer." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Producer pay" detail="The owner, admins and the bookkeeper reconcile producer pay." />;
  const { view: askedView, period: askedPeriod } = await searchParams;
  const view: ReconciliationView = VIEWS.includes(askedView as ReconciliationView) ? (askedView as ReconciliationView) : "pay";
  const period = parsePeriod(askedPeriod);
  const { from, to } = monthRange(period);
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId };
  const failed = (what: string) => (error: unknown) => { console.error(`[producer pay] ${what} could not be read`, error); return null; };

  // A read that fails shows "—", never $0.
  const [pay, truths, paidOut, roster, plans] = await Promise.all([
    producerPayFigures(viewer, from, to).catch(failed("figures")) as Promise<ProducerPayFigure[] | null>,
    readThreeTruths(viewer.tenantId, from, to, REVIEW_THRESHOLD_CENTS).catch(failed("three truths")),
    readMonthPayouts(viewer.tenantId, from, to).catch(failed("payouts")),
    readRoster(guard.context).catch(failed("roster")),
    listTeamPlans(viewer.tenantId).catch(failed("pay plans")),
  ]);
  const planOf = new Map((plans?.team ?? []).map((m) => [m.userId, m.plan]));
  const producers = (roster?.rows ?? []).map((p) => ({ userId: p.userId, producerId: p.id, name: p.displayName, plan: planShort(planOf.get(p.userId)) }));
  // AG-0.5: only the producers this session may see.
  const visible = roster?.scope ? new Set(roster.scope) : null;
  const truthRows = truths ? truths.rows.filter((r) => !visible || visible.has(r.producerUserId)) : null;
  const reviews = truths ? truths.reviews.filter((r) => !visible || visible.has(r.producerUserId)) : null;
  const openReviews = reviews?.filter((r) => r.status === "open").length ?? 0;

  const here = (next: ReconciliationView) => `${HREF}?${new URLSearchParams({ ...(next === "pay" ? {} : { view: next }), period })}`;
  const readOnly = guard.entitlement.access === "read_only";
  const payLabel = `Pay ${monthName(period)}`;
  const actions = (
    <>
      <ParamSelect label="Month" param="period" value={period} options={periodOptions()} />
      {readOnly
        ? <Button type="button" disabled title={READ_ONLY_REASON}>{payLabel}</Button>
        : <Button asChild type="button"><Link href={`/app/producer-payouts?period=${period}`}>{payLabel}</Link></Button>}
    </>
  );

  return (
    <CommissionsPage
      step="reconciliation"
      info={<>Each producer&apos;s pay for {monthLabel(period)}: what they earned, were advanced, charged back and paid, and what they are owed at the month&apos;s end. Three truths sets the rate card, the statements and the bank side by side.</>}
      tabs={<ViewTabs<ReconciliationView> label="Producer pay" value={view} tabs={[
        { key: "pay", label: "Pay", href: here("pay") },
        { key: "truths", label: "Three truths", href: here("truths") },
        { key: "review", label: "To review", count: reviews ? openReviews : null, tone: "danger", href: here("review") },
      ]} />}
      actions={actions}
    >
      <ReconciliationBoard
        view={view}
        period={period}
        threshold={REVIEW_THRESHOLD_CENTS}
        readOnly={readOnly}
        producers={producers}
        pay={pay}
        paidOut={paidOut ? Object.fromEntries(paidOut) : null}
        truths={truthRows}
        reviews={reviews}
      />
    </CommissionsPage>
  );
}
