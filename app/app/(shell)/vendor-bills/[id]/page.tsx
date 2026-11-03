import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { LEAD_TYPE_LABELS, PAID_METHOD_LABELS } from "@/lib/accounting/invoicesCore";
import { getInvoice, invoiceSources, InvoiceError } from "@/lib/accounting/invoiceStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { InvoiceActions, InvoiceStatusChip } from "@/components/app/accounting/invoices-board";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Accounting › Vendor bills › an invoice (LA-7.2; foundation pass 2026-11-03, was a side panel). The title is
 * the source and invoice number with its status; one line of facts; at most two buttons and More. The
 * figures are one strip; the tabs are Lines (each with its campaign, unattributed ones marked), Against our
 * count (what we recorded, rejected at the gate and credited, before approving — it flags, never blocks)
 * and In the ledger (the cost entries approving booked). Owner and bookkeeper only; opening writes nothing.
 */
type Tab = "lines" | "count" | "ledger";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (cents: number | null | undefined) => (cents == null ? "—" : formatCentsAsCurrency(cents));

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead invoices" description="What you paid for leads, invoice by invoice." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Lead invoices" detail="Only owners and bookkeepers can see what the agency pays." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const asked = (await searchParams).tab;
  const tab: Tab = asked === "count" || asked === "ledger" ? asked : "lines";
  const tenantId = guard.context.tenantId;
  let loaded: { inv: Awaited<ReturnType<typeof getInvoice>>; sources: Awaited<ReturnType<typeof invoiceSources>> } | null = null;
  let problem: string | null = null;
  try {
    const [inv, sources] = await Promise.all([getInvoice(tenantId, id), invoiceSources(tenantId)]);
    loaded = { inv, sources };
  } catch (error) {
    if (!(error instanceof InvoiceError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  if (!loaded) return <AccountingPage step="bills" title="Invoice"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  const { inv, sources } = loaded;
  const campaign = (cid: string | null) => (cid ? sources.campaigns.find((c) => c.id === cid)?.name ?? "Campaign" : "Unattributed");
  const s = inv.comparison.summary;
  const base = `/app/vendor-bills/${inv.id}`;
  const facts = [
    inv.sourceName,
    `dated ${inv.invoiceDate}`,
    inv.periodStart ? `for ${inv.periodStart} to ${inv.periodEnd ?? "…"}` : null,
    inv.dueDate ? `due ${inv.dueDate}` : null,
    inv.paidOn ? `paid ${inv.paidOn}${inv.paidMethod ? ` by ${PAID_METHOD_LABELS[inv.paidMethod]}` : ""}${inv.paymentReference ? `, ref ${inv.paymentReference}` : ""}` : null,
    inv.hasDocument ? inv.documentName ?? "Document attached" : "No document",
    inv.voidReason ? `Void: ${inv.voidReason}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <AccountingPage
      step="bills"
      title={inv.invoiceNumber}
      chip={<InvoiceStatusChip status={inv.status} paidOn={inv.paidOn} />}
      facts={facts}
      lead={<ViewTabs label="This invoice" value={tab} tabs={[
        { key: "lines", label: "Lines", count: inv.lines.length, href: base },
        { key: "count", label: "Against our count", count: s?.flagged ? 1 : null, tone: "danger", href: `${base}?tab=count` },
        { key: "ledger", label: "In the ledger", count: inv.entries.length, href: `${base}?tab=ledger` },
      ]} />}
      actions={<InvoiceActions readOnly={guard.entitlement.access === "read_only"} inv={{ id: inv.id, status: inv.status, sourceName: inv.sourceName, sourceType: inv.sourceType, sourceId: inv.sourceId, invoiceNumber: inv.invoiceNumber, taxCents: inv.taxCents, hasDocument: inv.hasDocument, lines: inv.lines, booked: inv.entries.length > 0 }} />}
    >
      {s?.flagged ? <Callout tone="warning" title={`Our count differs by ${money(Math.abs(s.differenceCents))}, more than your ${money(s.toleranceCents)} tolerance.`}>Check before paying; approving is still allowed.</Callout> : null}
      <StatStrip label="This invoice">
        <StatTile label="Total" value={money(inv.totalCents)} footnote={inv.taxCents ? `incl. ${money(inv.taxCents)} tax` : "no tax"} href={base} />
        <StatTile label="Difference from our count" value={s ? money(s.differenceCents) : "—"} valueTone={s?.flagged ? "warning" : undefined} footnote={s ? `tolerance ${money(s.toleranceCents)}` : "nothing we can count"} href={`${base}?tab=count`} />
        <StatTile label="Unattributed" value={money(inv.unattributed.amountCents)} valueTone={inv.unattributed.lines ? "warning" : undefined} footnote={`${inv.unattributed.lines} line${inv.unattributed.lines === 1 ? "" : "s"} with no campaign`} href={base} />
        <StatTile label="In the ledger" value={String(inv.entries.length)} footnote={inv.entries.length ? "cost entries" : "booked on approval"} href={`${base}?tab=ledger`} />
      </StatStrip>

      {tab === "count" ? (
        <TableCard footer={inv.comparison.frozen ? <p className="text-xs text-muted-foreground">As at approval.</p> : undefined}>
          <table className="portal-lead-table w-full min-w-[780px] text-left text-sm">
            <thead><tr><th>Line</th><th className="text-right">Invoiced</th><th className="text-right">We recorded</th><th className="text-right">Rejected</th><th className="text-right">Credits</th><th className="text-right">Our figure</th><th className="text-right">Difference</th></tr></thead>
            <tbody>
              {inv.comparison.rows.map((r) => {
                const line = inv.lines.find((l) => l.id === r.lineId);
                return (
                  <tr key={r.lineId} className="align-top">
                    <td>{line?.description ?? LEAD_TYPE_LABELS[r.leadType]}<div className="text-xs text-muted-foreground">{r.periodFrom} to {r.periodTo}</div></td>
                    <td className="text-right tabular-nums">{r.invoicedQuantity}<div className="text-xs text-muted-foreground">{money(r.invoicedCents)}</div></td>
                    {r.countable ? (
                      <>
                        <td className="text-right tabular-nums">{r.recorded}</td>
                        <td className="text-right tabular-nums">{r.rejected ? `−${r.rejected}` : "0"}</td>
                        <td className="text-right tabular-nums">{r.creditedCount ? `−${r.creditedCount}` : "0"}<div className="text-xs text-muted-foreground">{r.creditedCents ? `−${money(r.creditedCents)}` : ""}</div></td>
                        <td className="text-right tabular-nums">{r.ourCount}<div className="text-xs text-muted-foreground">{money(r.ourCents)}</div></td>
                        <td className={`text-right tabular-nums ${r.differenceCents ? "font-medium" : ""}`}>{r.differenceCents ? money(r.differenceCents) : "—"}</td>
                      </>
                    ) : <td colSpan={5} className="text-right text-xs text-muted-foreground">Not something we can count</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      ) : tab === "ledger" ? (
        <TableCard>
          {inv.entries.length === 0 ? <EmptyState title="Nothing booked yet" hint="Approving the invoice books its cost, in the month each line belongs to." /> : (
            <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
              <thead><tr><th>Entry</th><th className="w-[130px]">For</th><th className="w-[130px]">Paid</th><th className="w-[140px] text-right">Amount</th></tr></thead>
              <tbody>
                {inv.entries.map((e) => (
                  <tr key={e.id}><td>{e.description}{e.reverses ? <span className="text-xs text-muted-foreground"> · reversal</span> : null}</td><td className="tabular-nums">{e.incurredOn}</td><td className="tabular-nums">{e.paidOn ?? "—"}</td><td className={`text-right tabular-nums ${e.reverses ? "text-muted-foreground" : ""}`}>{money(e.amountCents)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : (
        <TableCard footer={inv.unattributed.lines ? <p className="text-xs text-[var(--warning-ink)]">{inv.unattributed.lines} line{inv.unattributed.lines === 1 ? "" : "s"} ({money(inv.unattributed.amountCents)}) not attributed to a campaign: counted in your costs, not in any campaign&apos;s cost per policy.</p> : undefined}>
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th>Line</th><th className="w-[200px]">Campaign</th><th className="w-[90px] text-right">Qty</th><th className="w-[120px] text-right">Unit</th><th className="w-[130px] text-right">Amount</th></tr></thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}<div className="text-xs text-muted-foreground">{LEAD_TYPE_LABELS[l.leadType]}{l.periodStart ? ` · ${l.periodStart} to ${l.periodEnd ?? "…"}` : ""}</div></td>
                  <td className={l.campaignId ? undefined : "text-[var(--warning-ink)]"}>{campaign(l.campaignId)}</td>
                  <td className="text-right tabular-nums">{l.quantity}</td>
                  <td className="text-right tabular-nums">{money(l.unitPriceCents)}</td>
                  <td className="text-right tabular-nums">{money(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </AccountingPage>
  );
}
