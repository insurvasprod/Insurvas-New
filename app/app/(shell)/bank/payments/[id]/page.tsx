import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { BankError, listAccounts, nearestDeposit, paymentLetters, paymentResults } from "@/lib/accounting/bankStore";
import { addDays, inPaymentFilter, orderPayments, paymentHref, readableDay, readPaymentsFrom, shortDay, paymentsFrom } from "@/lib/accounting/bankResultsCore";
import { policyHref } from "@/lib/ingestion/fileStages";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { PaymentActions, PaymentDeposit, PaymentLetters, PaymentPolicies, PaymentStrip, type PaymentTab, type PaymentView } from "@/components/app/accounting/bank-payment";
import { neighboursOf, RecordStepper } from "@/components/app/accounting/record-stepper";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Bank deposits › one carrier payment (owner's Accounting doc, round 1 boards B3/B4, 2026-11-07; round 7 boards 1·3,
 * 1·4, owner 2026-11-10). The address stays `/app/bank/payments/<statement id>`. The title alone, in words
 * ("Aflac · Sep 1, 2026 statement"); the figures are the strip; three tabs (`?tab=policies|deposit|letters`). The
 * ‹ › name the neighbouring payments in the Payments list's order and filter (worst first), read from `?from=`
 * (the list's period and chip), which they carry on. Owner and bookkeeper, as the page.
 */
const TABS: PaymentTab[] = ["policies", "deposit", "letters"];

export default async function BankPaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; tab?: string; show?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Bank deposits" description="What actually landed in the bank." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Bank deposits" detail="Only owners and bookkeepers can see the agency's bank lines." />;
  const [{ id }, q] = await Promise.all([params, searchParams]);
  if (!isRecordId(id)) notFound();
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const { period, filter } = readPaymentsFrom(q.from);
  const from = paymentsFrom(period, filter);
  const tab = TABS.find((t) => t === q.tab) ?? "policies";
  let loaded: { view: PaymentView; previous: { href: string; label: string } | null; next: { href: string; label: string } | null } | null = null;
  let problem: string | null = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    // The list it was opened from (for ‹ ›), and this payment in it; a payment outside the period is read on its own.
    const [list, accounts] = await Promise.all([paymentResults(tenantId, { since: addDays(today, -Number(period)), today }), listAccounts(tenantId)]);
    const r = list.rows.find((row) => row.id === id) ?? (await paymentResults(tenantId, { statementId: id })).rows[0];
    if (!r) notFound();
    const label = new Map(accounts.map((a) => [a.id, `${a.nickname}${a.lastFour ? ` ••${a.lastFour}` : ""}`]));
    const [near, letters] = await Promise.all([
      r.money === "missing" ? nearestDeposit(tenantId, r.statementDate, r.paidCents, list.windowDays) : null,
      paymentLetters(tenantId, r.policies.map((p) => p.findingId).filter((f): f is string => !!f)),
    ]);
    const ordered = orderPayments(list.rows.filter((row) => inPaymentFilter(row.verdict, filter)));
    const around = neighboursOf(ordered, id, (row) => row.id);
    const side = (row: typeof r | null) => (row ? { href: paymentHref(row.id, from), label: `${row.carrierName} · ${shortDay(row.statementDate)}` } : null);
    loaded = {
      previous: side(around.previous),
      next: side(around.next),
      view: {
        id: r.id, carrierId: r.carrierId, carrierName: r.carrierName, statementDate: r.statementDate, paidCents: r.paidCents, money: r.money, verdict: r.verdict, dueBy: r.dueBy, missingCents: r.missingCents, shortCents: r.shortCents, bankThrough: list.bankThrough,
        deposits: r.deposits.map((d) => ({ matchId: d.matchId, transactionId: d.transactionId, postedOn: d.postedOn, appliedCents: d.appliedCents, descriptionRaw: d.descriptionRaw, account: label.get(d.accountId) ?? "Bank", confirmed: d.confirmed })),
        policies: r.policies.map((p) => ({ ...p, href: policyHref(r.carrierId, p.policyNumber, "commissions") })),
        nearest: near ? { ...near, account: label.get(near.accountId) ?? "Bank" } : null,
        letters,
      },
    };
  } catch (error) {
    if (!(error instanceof BankError)) throw error;
    problem = error.message;
  }
  if (!loaded) return <AccountingPage step="bank"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  const { view: p, previous, next } = loaded;
  const base = paymentHref(p.id, from);
  const shortCount = p.policies.filter((x) => x.state === "short").length;
  const tabs = (
    <ViewTabs label="This payment" value={tab} tabs={[
      { key: "policies", label: "Policies", count: shortCount || p.policies.length, tone: shortCount ? "danger" : undefined, href: `${base}&tab=policies` },
      { key: "deposit", label: "The deposit", count: p.money === "missing" ? 1 : undefined, tone: "danger", href: `${base}&tab=deposit` },
      { key: "letters", label: "Letters", count: p.letters.length, href: `${base}&tab=letters` },
    ]} />
  );
  return (
    <AccountingPage
      step="bank"
      title={`${p.carrierName} · ${readableDay(p.statementDate)} statement`}
      tabs={tabs}
      stepper={<RecordStepper previous={previous} next={next} noun="payment" />}
      actions={<PaymentActions p={p} readOnly={readOnly} lettersHref={`${base}&tab=letters`} />}
    >
      <div className="flex flex-col gap-4">
        <PaymentStrip p={p} base={base} />
        {tab === "policies" ? <PaymentPolicies key={q.show ?? ""} p={p} readOnly={readOnly} show={q.show} />
          : tab === "deposit" ? <PaymentDeposit p={p} readOnly={readOnly} />
          : <PaymentLetters p={p} />}
      </div>
    </AccountingPage>
  );
}
