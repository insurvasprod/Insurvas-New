import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { readStatement } from "@/lib/agency/ledgerStore";
import { statementSurroundings } from "@/lib/agency/payoutStore";
import { buildStatement } from "@/lib/agency/statementCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { Button } from "@/components/ui/button";
import { ViewTabs } from "@/components/ui/view-tabs";
import { StatementAdjustments, StatementPayment, StatementStrip } from "@/components/app/agency/statement-view";
import { StatementMore, StatementPolicies } from "@/components/app/commissions/team-payouts/statement-parts";
import { NeighbourNav, periodWords } from "@/components/app/commissions/team-payouts/shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tab = "policies" | "adjustments" | "paid";

/**
 * AG-1.8 · one producer statement (round 7, owner pick 7·1, 2026-11-10; docs/la4/mockups-r7/commissions.html). The
 * same rules as its API (/api/app/agency/statements/<run>): the producer opens his own (another's is "not found"),
 * the owner, an admin and the bookkeeper any; a manager never (production, not pay).
 *
 * One page for both, in the Commissions frame. The owner: a record of Team payouts, titled "{Name} · {Month}", ‹ ›
 * the next person paid for the same month, ⋯ Void this run · Open {name}'s pay · Open the pay plan. The producer:
 * My pay's record, titled "{Month}", ‹ › his months either side, no Level column. Tabs: Policies · Adjustments · How
 * it was paid. A void run says so in the strip's Paid cell.
 */
export default async function ProducerStatementPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Statements" description="What each producer earned and what was taken back." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Statements" detail="Producers open their own statements; the owner, admins and the bookkeeper open any." />;
  const [{ runId }, { tab: asked }] = await Promise.all([params, searchParams]);
  if (!UUID.test(runId)) notFound();
  const tenantId = guard.context.tenantId;
  const data = await readStatement(tenantId, runId);
  if (!data) notFound();
  const keeper = actAsPage(guard, ["owner", "bookkeeper"]);
  if (!keeper && data.run.producerUserId !== guard.context.userId) notFound();
  if (guard.context.memberRole === "manager" && data.run.producerUserId !== guard.context.userId) notFound();
  const [around, money] = await Promise.all([
    statementSurroundings(tenantId, data.run, keeper ? "month" : "person").catch(() => ({ voidedAt: null, voidReason: null, producerRecordId: null, previous: null, next: null })),
    keeper ? guardPage("profit_and_loss") : Promise.resolve(null),
  ]);
  const statement = buildStatement(data.before, data.during, "reported");
  const carrierOf = new Map(data.during.map((e) => [e.id, e.carrierId]));
  const lines = statement.lines.map((l) => ({ ...l, carrierId: carrierOf.get(l.id) ?? null }));
  const tab: Tab = asked === "adjustments" || asked === "paid" ? asked : "policies";
  const when = periodWords(data.run.periodStart, data.run.periodEnd);
  const voided = data.run.status === "void" || Boolean(around.voidedAt);
  const run = { ...data.run, voided, voidedAt: around.voidedAt, voidReason: around.voidReason };

  const base = `/app/producer-statements/${runId}`;
  const tabs = <ViewTabs label="This statement" value={tab} tabs={[
    { key: "policies", label: "Policies", count: lines.length, href: base },
    { key: "adjustments", label: "Adjustments", count: statement.adjustments.length, href: `${base}?tab=adjustments` },
    { key: "paid", label: "How it was paid", href: `${base}?tab=paid` },
  ]} />;
  const link = (r: typeof around.previous) => (r ? { href: `/app/producer-statements/${r.id}${tab === "policies" ? "" : `?tab=${tab}`}`, label: keeper ? r.name : periodWords(r.periodStart, r.periodEnd) } : null);
  const pdf = <Button asChild variant="outline"><a href={`/api/app/agency/statements/${runId}?format=pdf`} download>Download PDF</a></Button>;
  const moneyActions = Boolean(money && money.entitled && actAsPage(money, ["owner", "bookkeeper"]) && guard.entitlement.access !== "read_only");
  const actions = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <NeighbourNav previous={link(around.previous)} next={link(around.next)} noun={keeper ? "person" : "month"} />
      {pdf}
      {keeper ? <StatementMore runId={runId} name={data.producer} period={when} canVoid={moneyActions && !voided} payHref={around.producerRecordId ? `/app/producers/${around.producerRecordId}?tab=money` : null} planHref={`/app/producer-payouts/plans/${data.run.producerUserId}`} /> : null}
    </span>
  );
  const body = (
    <>
      <StatementStrip run={run} statement={statement} policies={lines.length} />
      {tab === "adjustments" ? <StatementAdjustments statement={statement} />
        : tab === "paid" ? <StatementPayment run={run} statement={statement} agency={data.agency} own={!keeper} />
        : <StatementPolicies lines={lines} showLevel={keeper} />}
    </>
  );

  if (keeper) {
    const title = `${data.producer} · ${when}`;
    return (
      <CommissionsPage
        step="teamPayouts"
        title={title}
        breadcrumbs={[{ label: "Commissions" }, { label: "Team payouts", href: "/app/producer-payouts" }, { label: `Runs · ${when}`, href: `/app/producer-payouts?tab=runs&month=${data.run.periodStart.slice(0, 7)}` }, { label: data.producer }]}
        tabs={tabs}
        actions={actions}
      >
        {body}
      </CommissionsPage>
    );
  }
  return (
    <CommissionsPage step="reconciliation" pathname="/app/my-pay" title={when} breadcrumbs={[{ label: "Commissions" }, { label: "My pay", href: "/app/my-pay" }, { label: when }]} tabs={tabs} actions={actions}>
      {body}
    </CommissionsPage>
  );
}
