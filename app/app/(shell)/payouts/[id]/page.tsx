import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { PAID_METHOD_LABELS } from "@/lib/accounting/invoicesCore";
import { ITEM_LABELS } from "@/lib/accounting/payoutsCore";
import { invoiceRef, pctLabel } from "@/lib/accounting/partnerPayoutCore";
import { getRun, listRuns, PayoutError } from "@/lib/accounting/payoutStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { InvoiceActions, InvoiceDisputes, InvoiceItems } from "@/components/app/commissions/partner-payouts/invoice-parts";
import { listOrder, TAB_LABEL, tabOf, type InvoiceTab } from "@/components/app/commissions/partner-payouts/invoice-state";
import { NeighbourNav, periodWords, usDate, usDay } from "@/components/app/commissions/team-payouts/shared";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Commissions › Partner payouts › an invoice (round 7, owner pick 9·1, 2026-11-10; docs/la4/mockups-r7/commissions.html).
 * The title is the partner and the period ("Bright Path Media · October 2026"); the tabs are Statement (what the
 * partner reads: compliance rejections as a count only, never commission) · Items (a row opens the item, where a
 * draft's item is disputed) · Disputes (a row opens Resolve, once published) · Terms used (frozen with the draft).
 * ‹ › name the invoices either side in the tab it was opened from (`?from=`). The strip holds what the old facts line
 * said. The primary follows the state; ⋯ holds the downloads and Void the invoice. Owner and bookkeeper only;
 * opening it writes nothing.
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
const OUTCOME: Record<string, string> = { open: "Open", accepted: "Accepted, paid on the next invoice", upheld: "Upheld, stays deducted", void: "Void, its invoice was voided" };

export default async function PayoutRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; from?: string }> }) {
  const guard = await guardPage("payout_runs");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner payouts" description="What each partner is owed, from the ledger." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Partner payouts" detail="Only owners and bookkeepers can see what partners are paid." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { tab: asked, from: cameFrom } = await searchParams;
  const tab: Tab = asked === "items" || asked === "disputes" || asked === "terms" ? asked : "statement";
  const tenantId = guard.context.tenantId;
  let run: Awaited<ReturnType<typeof getRun>> | null = null;
  let list: Awaited<ReturnType<typeof listRuns>> | null = null;
  try {
    [run, list] = await Promise.all([getRun(tenantId, id), listRuns(tenantId).catch(() => null)]);
  } catch (error) {
    if (!(error instanceof PayoutError)) throw error;
    if (error.status === 404) notFound();
  }
  if (!run) return <CommissionsPage step="partnerPayouts" title="Partner invoice"><TableCard><EmptyState title="Partner payouts aren't switched on for this agency yet." hint="Invoices appear here once they are." /></TableCard></CommissionsPage>;

  const readOnly = guard.entitlement.access === "read_only";
  const when = periodWords(run.periodStart, run.periodEnd);
  const title = `${run.partnerName} · ${when}`;
  // ‹ ›: the invoices either side in the tab it came from (else its own tab), in the list's order.
  const from: InvoiceTab = cameFrom === "review" || cameFrom === "pay" || cameFrom === "paid" ? cameFrom : tabOf(run);
  const ordered = listOrder((list?.runs ?? []).filter((r) => tabOf(r) === from));
  const at = ordered.findIndex((r) => r.id === run!.id);
  const keep = (t: Tab) => new URLSearchParams({ ...(t === "statement" ? {} : { tab: t }), from }).toString();
  const near = (r: (typeof ordered)[number] | undefined) => (r ? { href: `/app/payouts/${r.id}?${keep(tab)}`, label: r.partnerName } : null);
  const base = `/app/payouts/${run.id}`;
  const openDisputes = run.disputes.filter((d) => d.status === "open").length;

  const status = run.status === "draft" ? { value: "Draft", note: "only you can see it", tone: "warning" as const }
    : run.status === "published" ? { value: "Published", note: run.publishedAt ? `the partner can see it · ${usDay(run.publishedAt)}` : "the partner can see it", tone: "info" as const }
    : run.status === "paid" ? { value: "Paid", note: [usDate(run.paidOn), run.paidMethod ? PAID_METHOD_LABELS[run.paidMethod] : null, run.paymentReference].filter((v) => v && v !== "—").join(" · "), tone: "good" as const }
    : { value: "Void", note: run.voidReason ?? "voided", tone: "neutral" as const };
  const rejections = run.items.filter((i) => i.itemType === "rejected").length;
  const credits = run.items.filter((i) => i.itemType === "credit").length;

  return (
    <CommissionsPage
      step="partnerPayouts"
      title={title}
      breadcrumbs={[{ label: "Commissions" }, { label: "Partner payouts", href: "/app/payouts" }, { label: TAB_LABEL[from], href: `/app/payouts?status=${from}` }, { label: title }]}
      tabs={<ViewTabs label="This invoice" value={tab} tabs={[
        { key: "statement", label: "Statement", href: `${base}?${keep("statement")}` },
        { key: "items", label: "Items", count: run.items.length, href: `${base}?${keep("items")}` },
        { key: "disputes", label: "Disputes", count: openDisputes, tone: "danger", href: `${base}?${keep("disputes")}` },
        { key: "terms", label: "Terms used", count: run.terms.length, href: `${base}?${keep("terms")}` },
      ]} />}
      actions={
        <span className="inline-flex flex-wrap items-center gap-2">
          <NeighbourNav previous={at > 0 ? near(ordered[at - 1]) : null} next={at >= 0 ? near(ordered[at + 1]) : null} noun="invoice" />
          <InvoiceActions run={{ id: run.id, status: run.status, netCents: run.netCents, partnerName: run.partnerName, periodLabel: when }} readOnly={readOnly} />
        </span>
      }
    >
      <StatStrip label="This invoice">
        <StatTile label="Status" valueSize="text" value={status.value} footnote={status.tone === "warning" && status.note ? <StatusChip tone="warning">{status.note.replace(/^./, (c) => c.toUpperCase())}</StatusChip> : status.note} />
        <StatTile label="Gross" value={money(run.grossCents)} footnote="priced from the terms" href={`${base}?${keep("items")}`} />
        <StatTile label="Deductions" value={money(-Math.abs(run.deductionsCents))} footnote={`${rejections} rejection${rejections === 1 ? "" : "s"} · ${credits} credit${credits === 1 ? "" : "s"}`} />
        <StatTile label="Net payable" value={money(run.netCents)} footnote={run.netCents < 0 ? <StatusChip tone="danger">{run.status === "paid" ? "Paid" : "Not paid from here"}</StatusChip> : run.status === "paid" ? "paid" : "not paid from here"} />
        <StatTile label="Invoice" valueSize="text" value={invoiceRef({ id: run.id, invoiceNumber: run.invoiceNumber })} footnote={`${usDay(run.periodStart)} – ${usDay(run.periodEnd)} · ${run.partnerName}`} />
      </StatStrip>

      {tab === "items" ? (
        <InvoiceItems
          runId={run.id}
          canDispute={run.status === "draft" && !readOnly}
          items={run.items.map((i) => ({
            id: i.id, label: ITEM_LABELS[i.itemType], occurredOn: i.occurredOn, clientName: i.clientName ?? null, policyNumber: i.policyNumber ?? null, carrier: i.carrier ?? null,
            how: howWorked(i), amountCents: i.amountCents, note: i.note, disputed: run!.disputes.some((d) => d.itemId === i.id), billable: BILLABLE.includes(i.itemType),
          }))}
        />
      ) : tab === "disputes" ? (
        <InvoiceDisputes
          runId={run.id}
          draft={run.status === "draft"}
          canResolve={!readOnly && (run.status === "published" || run.status === "paid")}
          disputes={run.disputes.map((d) => ({ id: d.id, side: d.side, reason: d.reason, claimCents: d.claimCents, status: d.status, resolutionNote: d.resolutionNote, carried: Boolean(d.carriedToRunId) }))}
        />
      ) : tab === "terms" ? (
        <TableCard footer={<p className="text-xs text-muted-foreground">Saved with the draft: later changes to the terms do not alter this invoice.</p>}>
          <Table>
            <TableHeader><TableRow><TableHead>Rate</TableHead><TableHead className="w-[30%]">Effective</TableHead></TableRow></TableHeader>
            <TableBody>{run.terms.map((t) => <TableRow key={t.id}><TableCell className="font-medium">{t.payout_model === "revenue_share" ? `${(t.rate_pct_bp ?? 0) / 100}% revenue share` : `${money(t.rate_cents ?? 0)} ${MODEL[t.payout_model] ?? t.payout_model}`}</TableCell><TableCell className="tabular-nums">{usDate(t.effective_from)}</TableCell></TableRow>)}</TableBody>
          </Table>
        </TableCard>
      ) : (
        <TableCard footer={<p className="text-xs text-muted-foreground">This is what the partner sees in their portal and on the PDF</p>}>
          <Table>
            <TableHeader><TableRow><TableHead>Activity</TableHead><TableHead className="w-[12%] text-right">Count</TableHead><TableHead className="w-[16%] text-right">Rate</TableHead><TableHead className="w-[16%] text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {run.lines.filter((l) => l.itemType !== "rejected" && l.itemType !== "credit" && l.itemType !== "revenue_share").map((l) => (
                <TableRow key={`${l.itemType}-${l.rateCents}`}>
                  <TableCell>{l.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.count}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{l.rateCents != null ? `@ ${money(l.rateCents)}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.amountCents)}</TableCell>
                </TableRow>
              ))}
              {run.items.filter((i) => i.itemType === "revenue_share").map((i) => (
                <TableRow key={i.id}>
                  <TableCell>Commission share<span className="text-xs text-muted-foreground"> · {[i.clientName, i.policyNumber && `policy ${i.policyNumber}`].filter(Boolean).join(" · ") || usDate(i.occurredOn)}</span></TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums text-muted-foreground">{howWorked(i) ?? ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(i.amountCents)}</TableCell>
                </TableRow>
              ))}
              {run.partnerView?.rejectedCount ? <TableRow><TableCell>{ITEM_LABELS.rejected}</TableCell><TableCell className="text-right tabular-nums">{run.partnerView.rejectedCount}</TableCell><TableCell /><TableCell className="text-right text-muted-foreground">—</TableCell></TableRow> : null}
              {run.partnerView?.credits.count ? <TableRow><TableCell>{ITEM_LABELS.credit} ({run.partnerView.credits.count})</TableCell><TableCell /><TableCell /><TableCell className="text-right tabular-nums">{money(run.partnerView.credits.amountCents)}</TableCell></TableRow> : null}
              {run.disputes.filter((d) => d.side === "agent").map((d) => (
                <TableRow key={d.id}><TableCell>Disputed: {d.reason}<span className="text-xs text-muted-foreground"> · {OUTCOME[d.status] ?? d.status}</span></TableCell><TableCell /><TableCell /><TableCell className="text-right tabular-nums">{money(-d.claimCents)}</TableCell></TableRow>
              ))}
              <TableRow className="border-t-2 border-border bg-[var(--surface-alt)] font-semibold"><TableCell>Net payable</TableCell><TableCell /><TableCell /><TableCell className="text-right tabular-nums">{money(run.netCents)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </TableCard>
      )}
    </CommissionsPage>
  );
}
