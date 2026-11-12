import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ledgerLive, listLedger, listRulebooks, listRuns, PayoutError } from "@/lib/accounting/payoutStore";
import { pctLabel, rulebookRateLabel } from "@/lib/accounting/partnerPayoutCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { PayoutActions } from "@/components/app/accounting/payouts-board";
import { LedgerBoard, RulebooksBoard, RunPayouts } from "@/components/app/accounting/partner-ledger-board";
import { InvoicesBoard } from "@/components/app/commissions/partner-payouts/invoices-board";
import { tabFromParams, tabOf, type PayoutsTab } from "@/components/app/commissions/partner-payouts/invoice-state";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * LA-7.4 · Commissions › Partner payouts (round 7, owner pick 9·A, 2026-11-10; docs/la4/mockups-r7/commissions.html).
 * Moved from the Accounting rail; same address. What each partner is owed, itemised from its rulebook, reviewed as
 * a draft and published to the partner's portal. Owner and bookkeeper only.
 *
 * The tabs on the title line are what you do next: To review (drafts) · To pay (published, unpaid) · Paid (with
 * Nothing owed and Void as chips) · Ledger · Rulebooks, each with its count (`?status=review|pay|paid`,
 * `?view=ledger|rulebooks`; the old `?status=draft|published|void` and `?view=invoices` land on the right tab).
 * Run payouts is the primary, Draft one partner the secondary. `?open=<id>` (the P&L's drill-through) lands on
 * the invoice.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (c: number) => formatCentsAsCurrency(c);

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ open?: string; status?: string; view?: string; state?: string; partner?: string }> }) {
  const guard = await guardPage("payout_runs");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Partner payouts" description="What each partner is owed, from the ledger." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Partner payouts" detail="Only owners and bookkeepers can see what partners are paid." />;
  }
  const [{ open, status, view, state, partner }, records] = await Promise.all([searchParams, guardPage("publisher_records")]);
  if (open && UUID.test(open)) redirect(`/app/payouts/${open}`);
  const asked = tabFromParams(view, status);
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const live = await ledgerLive().catch(() => false);
  const partnerId = partner && UUID.test(partner) ? partner : null;

  const quiet = <T,>(p: Promise<T>) => p.catch((error: unknown) => { if (!(error instanceof PayoutError)) throw error; return null; });
  // Every tab's count is on the bar, so the three lists are read together; the ledger is synced only when it is the tab.
  const [runs, ledger, rulebooks] = await Promise.all([
    quiet(listRuns(tenantId)),
    live ? quiet(listLedger(tenantId, asked === "ledger" ? { partnerId } : { sync: false })) : Promise.resolve(null),
    live ? quiet(listRulebooks(tenantId)) : Promise.resolve(null),
  ]);
  const of = (t: "review" | "pay" | "paid") => (runs?.runs ?? []).filter((r) => tabOf(r) === t);
  // Landing with no tab asked: the first job waiting (review, then pay), else Paid.
  const tab: PayoutsTab = asked ?? (of("review").length ? "review" : of("pay").length ? "pay" : "paid");
  const unset = rulebooks?.filter((r) => !r.model).length ?? 0;

  const tabs = <ViewTabs label="Partner payouts" value={tab} tabs={[
    { key: "review", label: "To review", count: runs ? of("review").length : null, href: "/app/payouts?status=review" },
    { key: "pay", label: "To pay", count: runs ? of("pay").length : null, href: "/app/payouts?status=pay" },
    { key: "paid", label: "Paid", count: runs ? of("paid").length : null, href: "/app/payouts?status=paid" },
    { key: "ledger", label: "Ledger", count: ledger?.rows.length ?? null, href: "/app/payouts?view=ledger" },
    { key: "rulebooks", label: "Rulebooks", count: unset || null, tone: "danger", href: "/app/payouts?view=rulebooks" },
  ]} />;
  const waiting = <TableCard><EmptyState title="Partner payouts aren't switched on for this agency yet." hint="Invoices, the ledger and rulebooks appear here once they are." /></TableCard>;

  // The rulebook, in words, beside each invoice.
  const models: Record<string, string> = {};
  for (const r of rulebooks ?? []) {
    const rate = rulebookRateLabel(r.model, r.rateCents, r.ratePctBp, money);
    models[r.partnerId] = r.model === "per_submitted_application" ? `Model A · ${rate}` : r.model === "revenue_share" ? `Model B · ${r.ratePctBp != null ? pctLabel(r.ratePctBp) : rate}` : rate ? `Older terms · ${rate}` : "No rulebook yet";
  }
  const items: Record<string, number> = {};
  for (const row of ledger?.rows ?? []) if (row.runId) items[row.runId] = (items[row.runId] ?? 0) + 1;

  const actions = runs ? <>{live ? <PayoutActions partners={runs.partners} readOnly={readOnly} secondary /> : <PayoutActions partners={runs.partners} readOnly={readOnly} />}{live ? <RunPayouts readOnly={readOnly} /> : null}</> : undefined;

  return (
    <CommissionsPage
      step="partnerPayouts"
      info="Each partner is paid by its rulebook. Run payouts drafts an invoice for each partner whose pay period has ended; publish shares it, mark paid stamps its items. Nothing here moves money."
      tabs={tabs}
      actions={actions}
    >
      {tab === "ledger" ? (ledger ? <LedgerBoard rows={ledger.rows} partners={ledger.partners} initialState={state} initialPartner={partner} /> : waiting)
        : tab === "rulebooks" ? (rulebooks ? <RulebooksBoard rows={rulebooks} /> : waiting)
        : runs ? <InvoicesBoard key={tab} tab={tab} runs={of(tab)} items={items} models={models} recordLinks={records.entitled} /> : waiting}
    </CommissionsPage>
  );
}
