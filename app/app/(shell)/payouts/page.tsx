import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ledgerLive, listLedger, listRulebooks, listRuns, LEDGER_PENDING_MESSAGE, PayoutError } from "@/lib/accounting/payoutStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { PayoutActions, PayoutsBoard } from "@/components/app/accounting/payouts-board";
import { LedgerBoard, RulebooksBoard, RunPayouts } from "@/components/app/accounting/partner-ledger-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Accounting › Partner payouts (LA-7.4, Notion sprint). What each partner is owed, itemised from its
 * terms, reviewed as a draft and published to the partner's portal. Owner and bookkeeper only.
 *
 * 2026-11-03 (owner): moved from Partners into Accounting, where Module 7 puts it, at the same address. A run
 * opens as its own page; `?open=<id>` (the P&L's drill-through) lands there; `?status=` is a figure's rows.
 *
 * 2026-11-06 (owner, partner payouts rework): three tabs on the title line — Invoices (the runs), Ledger (every
 * item each partner earned: unpaid, on an invoice, PAID) and Rulebooks (how each partner is paid). Run payouts
 * makes a draft invoice for every partner whose pay schedule has ended. Until the database paste lands, the
 * new tabs say they are waiting and Invoices works as before.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type View = "invoices" | "ledger" | "rulebooks";

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ open?: string; status?: string; view?: string; state?: string; partner?: string }> }) {
  const guard = await guardPage("payout_runs");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Partner payouts" description="What each partner is owed, from the ledger." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Partner payouts" detail="Only owners and bookkeepers can see what partners are paid." />;
  }
  const [{ open, status, view: asked, state, partner }, records] = await Promise.all([searchParams, guardPage("publisher_records")]);
  if (open && UUID.test(open)) redirect(`/app/payouts/${open}`);
  const view: View = asked === "ledger" || asked === "rulebooks" ? asked : "invoices";
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const live = await ledgerLive().catch(() => false);

  let runs: Awaited<ReturnType<typeof listRuns>> | null = null;
  let ledger: Awaited<ReturnType<typeof listLedger>> | null = null;
  let rulebooks: Awaited<ReturnType<typeof listRulebooks>> | null = null;
  let problem: string | null = null;
  try {
    if (view === "ledger") ledger = await listLedger(tenantId, { partnerId: partner && UUID.test(partner) ? partner : null });
    else if (view === "rulebooks") rulebooks = await listRulebooks(tenantId);
    else runs = await listRuns(tenantId);
  } catch (error) {
    if (!(error instanceof PayoutError)) throw error;
    problem = error.message;
  }

  const tabs = <ViewTabs label="Partner payouts" value={view} tabs={[
    { key: "invoices", label: "Invoices", href: "/app/payouts" },
    { key: "ledger", label: "Ledger", href: "/app/payouts?view=ledger" },
    { key: "rulebooks", label: "Rulebooks", href: "/app/payouts?view=rulebooks" },
  ]} />;
  const waiting = <TableCard><EmptyState title="Not switched on yet" hint={problem ?? LEDGER_PENDING_MESSAGE} /></TableCard>;

  return (
    <AccountingPage
      step="payouts"
      info="Each partner is paid by its rulebook: Model A, a flat rate once a transferred client's application is submitted; Model B, a share of the commission received on an issued policy. Every item goes into the ledger once. Run payouts makes a draft invoice for each partner whose pay schedule has ended, with every unpaid item locked to it; marking it paid stamps them PAID, so nothing is paid twice. Publishing shares the invoice and its PDF in the partner's portal and books the cost. Nothing here moves money."
      lead={tabs}
      actions={view === "invoices" && runs ? <>{live ? <RunPayouts readOnly={readOnly} /> : null}<PayoutActions partners={runs.partners} readOnly={readOnly} secondary={live} /></> : view === "ledger" && live ? <RunPayouts readOnly={readOnly} /> : undefined}
    >
      {view === "ledger" ? (ledger ? <LedgerBoard rows={ledger.rows} partners={ledger.partners} initialState={state} initialPartner={partner} /> : waiting)
        : view === "rulebooks" ? (rulebooks ? <RulebooksBoard rows={rulebooks} readOnly={readOnly} /> : waiting)
        : runs ? <PayoutsBoard runs={runs.runs} partners={runs.partners} readOnly={readOnly} status={status} recordLinks={records.entitled} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}
