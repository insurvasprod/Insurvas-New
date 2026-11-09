import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { BankError, listAccounts, nearestDeposit, paymentResults } from "@/lib/accounting/bankStore";
import { VERDICT_LABELS, VERDICT_TONES } from "@/lib/accounting/bankResultsCore";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { PaymentActions, PaymentBody, type PaymentView } from "@/components/app/accounting/bank-payment";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";

/**
 * Bank deposits › Results › one carrier payment (owner's Accounting doc, round 1 boards B3/B4, 2026-11-07).
 * The lump sum against the bank, then each policy against the rate card. Owner and bookkeeper, as the page.
 */
export default async function BankPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Bank deposits" description="What actually landed in the bank." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Bank deposits" detail="Only owners and bookkeepers can see the agency's bank lines." />;
  const { id } = await params;
  if (!isRecordId(id)) notFound();
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  let loaded: { r: Awaited<ReturnType<typeof paymentResults>>["rows"][number]; view: PaymentView } | null = null;
  let problem: string | null = null;
  try {
    const [found, accounts] = await Promise.all([paymentResults(tenantId, { statementId: id }), listAccounts(tenantId)]);
    const r = found.rows[0];
    if (!r) notFound();
    const label = new Map(accounts.map((a) => [a.id, `${a.nickname}${a.lastFour ? ` ••${a.lastFour}` : ""}`]));
    const near = r.money === "missing" ? await nearestDeposit(tenantId, r.statementDate, r.paidCents, found.windowDays) : null;
    loaded = {
      r,
      view: {
        id: r.id, carrierId: r.carrierId, carrierName: r.carrierName, statementDate: r.statementDate, paidCents: r.paidCents, money: r.money, dueBy: r.dueBy, missingCents: r.missingCents, bankThrough: found.bankThrough,
        deposits: r.deposits.map((d) => ({ matchId: d.matchId, postedOn: d.postedOn, appliedCents: d.appliedCents, descriptionRaw: d.descriptionRaw, account: label.get(d.accountId) ?? "Bank", confirmed: d.confirmed })),
        policies: r.policies,
        nearest: near ? { ...near, account: label.get(near.accountId) ?? "Bank" } : null,
      },
    };
  } catch (error) {
    if (!(error instanceof BankError)) throw error;
    problem = error.message;
  }
  if (!loaded) return <AccountingPage step="bank"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  const { r, view } = loaded;
  const amount = r.verdict === "bad_math" ? ` · ${formatCentsAsCurrency(r.shortCents)}` : r.verdict === "missing_money" ? ` · ${formatCentsAsCurrency(r.missingCents)}` : "";
  return (
    <AccountingPage
      step="bank"
      title={`${r.carrierName} · ${r.statementDate} · ${formatCentsAsCurrency(r.paidCents)}`}
      chip={<StatusChip tone={VERDICT_TONES[r.verdict]}>{VERDICT_LABELS[r.verdict]}{amount}</StatusChip>}
      facts={<>Bank deposits › Results · {r.policies.length} {r.policies.length === 1 ? "policy" : "policies"} · deposit due by {r.dueBy}</>}
      actions={<PaymentActions p={view} readOnly={readOnly} />}
    >
      <PaymentBody p={view} readOnly={readOnly} />
    </AccountingPage>
  );
}
