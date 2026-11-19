import { Suspense } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ProducerMoneyTab } from "@/components/app/agency/producer-money-tab";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { ParamSelect } from "@/components/app/commissions/producer-pay/param-select";
import { parseYear } from "@/components/app/commissions/producer-pay/period";
import { moneyLists, type MoneyData, type MoneyView } from "@/components/app/commissions/producer-pay/money-core";
import { ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { StreamSection } from "@/components/ui/stream-section";
import { Part, startParts } from "@/components/app/commissions/frame-parts";
import { readBalances, readProducerEntries, syncLedger } from "@/lib/agency/ledgerStore";
import { readRuns } from "@/lib/agency/payoutStore";
import { teamMember } from "@/lib/agency/payPlanStore";

const HREF = "/app/my-pay";
const VIEWS: MoneyView[] = ["statements", "ledger", "chargebacks"];

/**
 * AG-1.5 / AG-1.8 · Commissions › My pay: a producer's own pay — no asking anyone.
 *
 * Round 7, direction A (owner 2026-11-10, docs/la4/mockups-r7/commissions.html 5·A): statements first. Statements ·
 * Ledger · Chargebacks are the title line's tabs (?view=) and the year is a select beside them (?year=); a month
 * opens its statement. The same reads as /api/app/agency/my-pay, made here so the tabs carry their counts.
 */
export default async function MyPayPage({ searchParams }: { searchParams: Promise<{ view?: string; year?: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="My pay" description="What you earned, what came back, and every statement." />;
  if (!actAsPage(guard, ["producer"])) return <RoleGateNotice featureLabel="My pay" detail="My pay is a producer's own page. The owner sees everyone's pay under Commissions › Producer pay and Team payouts." action={{ href: "/app/producer-reconciliation", label: "Open Producer pay" }} />;
  const { view: askedView, year: askedYear } = await searchParams;
  const view: MoneyView = VIEWS.includes(askedView as MoneyView) ? (askedView as MoneyView) : "statements";
  const year = parseYear(askedYear);
  const { tenantId, userId } = guard.context;

  const here = (next: MoneyView) => `${HREF}?${new URLSearchParams({ ...(next === "statements" ? {} : { view: next }), year })}`;
  const thisYear = new Date().toISOString().slice(0, 4);
  // The tabs and the year select on the title line; their counts, and the years back to the first entry, once read.
  const tabsOf = (lists: ReturnType<typeof moneyLists> | null) => (
    <ViewTabs<MoneyView> label="My pay" value={view} tabs={[
      { key: "statements", label: "Statements", count: lists ? lists.statements.filter((s) => s.runId).length : null, href: here("statements") },
      { key: "ledger", label: "Ledger", count: lists?.ledger.length ?? null, href: here("ledger") },
      { key: "chargebacks", label: "Chargebacks", count: lists?.chargebacks.length ?? null, href: here("chargebacks") },
    ]} />
  );
  const yearsFrom = (firstYear: string) => Array.from({ length: Number(thisYear) - Number(firstYear < year ? firstYear : year) + 1 }, (_, i) => String(Number(thisYear) - i)).map((y) => ({ value: y, label: y }));
  const yearSelect = (firstYear: string) => <ParamSelect label="Year" param="year" value={year} options={yearsFrom(firstYear)} />;

  // Frame first (§7a): the title, tabs and year draw at once; the ledger is synced and read under them.
  const read = startParts((async () => {
    let data: MoneyData | null = null;
    try {
      await syncLedger(tenantId).catch(() => 0);
      const [balances, entries, runs, member] = await Promise.all([
        readBalances(guard.context),
        readProducerEntries(tenantId, userId),
        readRuns(tenantId, userId),
        teamMember(tenantId, userId).catch(() => null),
      ]);
      data = { balances: balances.rows.filter((b) => b.producerUserId === userId), entries, runs: runs.filter((r) => r.producerUserId === userId), plan: member?.plan ?? null };
    } catch (error) {
      console.error("[my pay] could not be read", error);
    }
    const firstYear = data?.entries.reduce((min, e) => (e.occurredOn.slice(0, 4) < min ? e.occurredOn.slice(0, 4) : min), year) ?? year;
    return {
      tabs: tabsOf(data ? moneyLists(data, year) : null),
      actions: yearSelect(firstYear),
      body: data ? <ProducerMoneyTab data={data} audience="self" view={view} selection={year} /> : <TableCard><ErrorState detail="Your pay could not be read. Refresh to try again." /></TableCard>,
    };
  })());

  return (
    <CommissionsPage
      step="reconciliation"
      pathname={HREF}
      info="What you earned, what came back and what the agency paid you, month by month. Each month opens its statement, line by line."
      tabs={<Suspense fallback={tabsOf(null)}><Part read={read} part="tabs" /></Suspense>}
      actions={<Suspense fallback={yearSelect(year)}><Part read={read} part="actions" /></Suspense>}
    >
      <StreamSection shape="strip+table"><Part read={read} part="body" /></StreamSection>
    </CommissionsPage>
  );
}
