import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { PAID_METHOD_LABELS } from "@/lib/accounting/invoicesCore";
import { ITEM_LABELS } from "@/lib/accounting/payoutsCore";
import { invoiceRef, pctLabel } from "@/lib/accounting/partnerPayoutCore";
import { dayMonth, dayMonthYear } from "@/lib/format/dates";
import { getRun, PayoutError } from "@/lib/accounting/payoutStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { DisputeItem, ResolveDispute, RunActions, RunStatusChip } from "@/components/app/accounting/payouts-board";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Accounting › Partner payouts › a run (LA-7.4; 2026-11-03, was a 960px pop-up). The title is the partner with
 * the run's status; one line of facts; Publish or Mark paid, and More. The figures are one strip; the tabs
 * are Statement (what the partner reads: compliance rejections as a count only, never commission), Items
 * (each priced item, disputable while a draft), Disputes (resolved once published) and Terms used (frozen
 * with the draft). Owner and bookkeeper only; opening it writes nothing.
 *
 * 2026-11-06 (owner, partner payouts rework): a run is the partner's invoice — numbered, with its PDF in More,
 * each item showing its client or policy and how it was worked out (a flat rate, or a share of the commission
 * received), and Publish & share puts it in the partner's portal.
 */
type Tab = "statement" | "items" | "disputes" | "terms";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (c: number) => formatCentsAsCurrency(c);
const MODEL: Record<string, string> = { per_submitted_application: "per submitted application", per_transfer: "per transfer", per_lead: "per lead", per_sale: "per sale", per_issued_policy: "per issued policy", revenue_share: "revenue share" };
const BILLABLE = ["submitted_application", "transfer", "lead", "sale", "issued_policy", "revenue_share", "adjustment", "clawback", "carried_balance"];
/** How an item was worked out: "50% of $1,000.00", or the flat rate. */
const howWorked = (i: { itemType: string; ratePctBp: number | null; basisCents?: number | null; rateAppliedCents: number | null }) =>
  i.itemType === "revenue_share" && i.ratePctBp != null && i.basisCents != null ? `${pctLabel(i.ratePctBp)} of ${money(i.basisCents)}`
    : i.rateAppliedCents != null && i.itemType !== "credit" && i.itemType !== "adjustment" ? `${money(i.rateAppliedCents)} each` : null;
const OUTCOME: Record<string, string> = { open: "Open", accepted: "Accepted, paid on the next run", upheld: "Upheld, stays deducted", void: "Void, its run was voided" };

export default async function PayoutRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("payout_runs");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner payouts" description="What each partner is owed, from the ledger." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Partner payouts" detail="Only owners and bookkeepers can see what partners are paid." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const asked = (await searchParams).tab;
  const tab: Tab = asked === "items" || asked === "disputes" || asked === "terms" ? asked : "statement";
  let run: Awaited<ReturnType<typeof getRun>> | null = null;
  let problem: string | null = null;
  try {
    run = await getRun(guard.context.tenantId, id);
  } catch (error) {
    if (!(error instanceof PayoutError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  if (!run) return <AccountingPage step="payouts" title="Payout run"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  const readOnly = guard.entitlement.access === "read_only";
  const base = `/app/payouts/${run.id}`;
  const openDisputes = run.disputes.filter((d) => d.status === "open").length;
  // One short line (/ui-taste pass, owner 2026-11-09): which invoice, which pay period, and where it stands.
  const facts = [
    `Invoice ${invoiceRef({ id: run.id, invoiceNumber: run.invoiceNumber })}`,
    `${dayMonth(run.periodStart)} – ${dayMonthYear(run.periodEnd)}`,
    run.status === "draft" ? "only you can see it until you publish" : null,
    run.paidOn ? `paid ${dayMonthYear(run.paidOn)}${run.paidMethod ? ` by ${PAID_METHOD_LABELS[run.paidMethod]}` : ""}${run.paymentReference ? ` (${run.paymentReference})` : ""}` : null,
    run.voidReason ? `void: ${run.voidReason}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <AccountingPage
      step="payouts"
      title={run.partnerName}
      chip={<RunStatusChip status={run.status} paidOn={run.paidOn} />}
      facts={facts}
      tabs={<ViewTabs label="This run" value={tab} tabs={[
        { key: "statement", label: "Statement", href: base },
        { key: "items", label: "Items", count: run.items.length, href: `${base}?tab=items` },
        { key: "disputes", label: "Disputes", count: openDisputes || null, tone: "danger", href: `${base}?tab=disputes` },
        { key: "terms", label: "Terms used", count: run.terms.length, href: `${base}?tab=terms` },
      ]} />}
      actions={<RunActions run={{ id: run.id, status: run.status, netCents: run.netCents, partnerName: run.partnerName }} readOnly={readOnly} />}
    >
      <StatStrip label="Payout summary">
        <StatTile label="Gross" value={money(run.grossCents)} footnote="priced from the terms" href={`${base}?tab=items`} />
        <StatTile label="Deductions" value={money(run.deductionsCents)} footnote="credits and rejections" href={base} />
        <StatTile label="Disputed" value={money(run.disputedCents)} footnote={`${openDisputes} open`} href={`${base}?tab=disputes`} />
        <StatTile label="Net payable" value={money(run.netCents)} footnote={run.status === "paid" ? "paid" : "not paid from here"} href={base} />
      </StatStrip>

      {tab === "items" ? (
        <PagedTableCard total={run.items.length} noun="items">
          {run.items.length === 0 ? <EmptyState title="No items" hint="Nothing the partner delivered in this period was priced." /> : (
            <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
              <thead><tr><th>Date</th><th>Item</th><th>Client · policy</th><th>How</th><th className="text-right">Amount</th><th className="text-right"><span className="sr-only">Dispute</span></th></tr></thead>
              <PagedBody>
                {run.items.map((i) => {
                  const disputed = run.disputes.some((d) => d.itemId === i.id);
                  return (
                    <tr key={i.id}>
                      <td className="tabular-nums">{i.occurredOn}</td>
                      <td>{ITEM_LABELS[i.itemType]}{i.note ? <span className="text-xs text-muted-foreground"> · {i.note}</span> : null}{disputed ? <span className="text-xs text-[var(--warning-ink)]"> · disputed</span> : null}</td>
                      <td>{i.clientName ?? (i.policyNumber ? "" : <span className="text-muted-foreground">—</span>)}{i.policyNumber ? <span className="block text-xs text-muted-foreground">{i.carrier ? `${i.carrier} · ` : ""}{i.policyNumber}</span> : null}</td>
                      <td className="text-muted-foreground">{howWorked(i) ?? ""}</td>
                      <td className={`text-right tabular-nums ${i.amountCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(i.amountCents)}</td>
                      <td className="text-right">{run.status === "draft" && BILLABLE.includes(i.itemType) && !disputed && !readOnly ? <DisputeItem runId={run.id} itemId={i.id} label={`${ITEM_LABELS[i.itemType]} of ${i.occurredOn}`} /> : null}</td>
                    </tr>
                  );
                })}
              </PagedBody>
            </table>
          )}
        </PagedTableCard>
      ) : tab === "disputes" ? (
        <TableCard>
          {run.disputes.length === 0 ? <EmptyState title="No disputes" hint="Dispute an item on the Items tab while the run is a draft; the partner can raise one once it is published." /> : (
            <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
              <thead><tr><th>Raised by</th><th>Reason</th><th className="text-right">Claim</th><th>Outcome</th><th className="text-right"><span className="sr-only">Resolve</span></th></tr></thead>
              <tbody>
                {run.disputes.map((d) => (
                  <tr key={d.id}>
                    <td>{d.side === "partner" ? "The partner" : "You"}</td>
                    <td>{d.reason}</td>
                    <td className="text-right tabular-nums">{money(d.claimCents)}</td>
                    <td>{OUTCOME[d.status] ?? d.status}{d.resolutionNote ? <span className="text-xs text-muted-foreground"> · {d.resolutionNote}</span> : null}{d.carriedToRunId ? <span className="text-xs text-muted-foreground"> · carried</span> : null}</td>
                    <td className="text-right">{d.status === "open" && !readOnly && (run.status === "published" || run.status === "paid") ? <ResolveDispute runId={run.id} dispute={d} /> : d.status === "open" && run.status === "draft" ? <span className="text-xs text-muted-foreground">Resolved once published</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : tab === "terms" ? (
        <TableCard footer={<p className="text-xs text-muted-foreground">Saved with the draft: later changes to the terms do not alter this run.</p>}>
          <table className="portal-lead-table w-full min-w-[520px] text-left text-sm">
            <thead><tr><th>Rate</th><th>Effective</th></tr></thead>
            <tbody>{run.terms.map((t) => <tr key={t.id}><td className="font-medium">{t.payout_model === "revenue_share" ? `${(t.rate_pct_bp ?? 0) / 100}% revenue share` : `${money(t.rate_cents ?? 0)} ${MODEL[t.payout_model] ?? t.payout_model}`}</td><td className="tabular-nums">{t.effective_from}</td></tr>)}</tbody>
          </table>
        </TableCard>
      ) : (
        <TableCard footer={<p className="text-xs text-muted-foreground">This is what the partner sees in their portal and on the PDF.</p>}>
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>Activity</th><th className="text-right">Count</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {run.lines.filter((l) => l.itemType !== "rejected" && l.itemType !== "credit" && l.itemType !== "revenue_share").map((l) => (
                <tr key={`${l.itemType}-${l.rateCents}`}>
                  <td>{l.label}</td>
                  <td className="text-right tabular-nums">{l.itemType === "revenue_share" ? "" : l.count}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{l.rateCents != null ? `@ ${money(l.rateCents)}` : ""}</td>
                  <td className="text-right tabular-nums">{money(l.amountCents)}</td>
                </tr>
              ))}
              {run.items.filter((i) => i.itemType === "revenue_share").map((i) => (
                <tr key={i.id}>
                  <td>Commission share<span className="text-xs text-muted-foreground"> · {[i.clientName, i.policyNumber && `policy ${i.policyNumber}`].filter(Boolean).join(" · ") || i.occurredOn}</span></td>
                  <td />
                  <td className="text-right tabular-nums text-muted-foreground">{howWorked(i) ?? ""}</td>
                  <td className={`text-right tabular-nums ${i.amountCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(i.amountCents)}</td>
                </tr>
              ))}
              {run.partnerView?.rejectedCount ? <tr><td>{ITEM_LABELS.rejected}</td><td className="text-right tabular-nums">{run.partnerView.rejectedCount}</td><td /><td className="text-right text-muted-foreground">—</td></tr> : null}
              {run.partnerView?.credits.count ? <tr><td>{ITEM_LABELS.credit} ({run.partnerView.credits.count})</td><td /><td /><td className="text-right tabular-nums">{money(run.partnerView.credits.amountCents)}</td></tr> : null}
              {run.disputes.filter((d) => d.side === "agent").map((d) => (
                <tr key={d.id}><td>Disputed: {d.reason}<span className="text-xs text-muted-foreground"> · {OUTCOME[d.status] ?? d.status}</span></td><td /><td /><td className="text-right tabular-nums">{money(-d.claimCents)}</td></tr>
              ))}
              <tr className="border-t-2 border-border bg-[var(--surface-alt)] font-semibold"><td>Net payable</td><td /><td /><td className="text-right tabular-nums">{money(run.netCents)}</td></tr>
            </tbody>
          </table>
        </TableCard>
      )}
    </AccountingPage>
  );
}
