import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { PAID_METHOD_LABELS } from "@/lib/accounting/invoicesCore";
import { BILL_TABS, billDate, billHref, billMonth, billPeriod, onBillTab, type BillTab } from "@/lib/accounting/billTabs";
import { getInvoice, invoiceSources, InvoiceError, listInvoices } from "@/lib/accounting/invoiceStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { RecordStepper, neighboursOf } from "@/components/app/accounting/record-stepper";
import { BillCompare, BillDocument, BillLines, InvoiceActions, InvoiceStatusChip } from "@/components/app/accounting/invoices-board";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Accounting › Vendor bills › a bill (LA-7.2; round 7, owner 2026-11-10: mockups-r7/accounting.html 2·1, 2·2, 2·5).
 * The title is the vendor and the bill number alone; the figures are one strip (Total · Our count · Billed more
 * by · Status · Booked in the P&L). The tabs are Lines, Compare to our count (a red count while it differs past
 * the tolerance, and the tab the bill opens on then), Booked and Document. ‹ › name the neighbouring bills in
 * the list it was opened from (`?from=`, a status tab); the primary follows the status (InvoiceActions). Owner
 * and bookkeeper only; opening writes nothing.
 */
type Tab = "lines" | "count" | "ledger" | "document";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (cents: number | null | undefined) => (cents == null ? "—" : formatCentsAsCurrency(cents));
const TABS: readonly Tab[] = ["lines", "count", "ledger", "document"];

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; from?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Vendor bills" description="What you paid for leads, bill by bill." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Vendor bills" detail="Only owners and bookkeepers can see what the agency pays." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { tab: asked, from: fromParam } = await searchParams;
  const tenantId = guard.context.tenantId;
  let loaded: { inv: Awaited<ReturnType<typeof getInvoice>>; sources: Awaited<ReturnType<typeof invoiceSources>>; list: Awaited<ReturnType<typeof listInvoices>> } | null = null;
  let problem: string | null = null;
  try {
    const [inv, sources, list] = await Promise.all([getInvoice(tenantId, id), invoiceSources(tenantId), listInvoices(tenantId)]);
    loaded = { inv, sources, list };
  } catch (error) {
    if (!(error instanceof InvoiceError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  if (!loaded) return <AccountingPage step="bills" title="Vendor bill"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  const { inv, sources, list } = loaded;
  const readOnly = guard.entitlement.access === "read_only";
  const s = inv.comparison.summary;
  const differs = Boolean(s?.flagged);
  const tab: Tab = TABS.includes(asked as Tab) ? (asked as Tab) : differs ? "count" : "lines";

  // ‹ ›: the list it was opened from (a status tab), in the list's own order; else the tab its status sits on.
  const from: BillTab = BILL_TABS.some((t) => t.key === fromParam) ? (fromParam as BillTab) : (BILL_TABS.find((t) => t.key !== "all" && onBillTab(inv.status, t.key))?.key ?? "all");
  const walk = list.filter((b) => onBillTab(b.status, from));
  const { previous, next } = neighboursOf(walk, inv.id, (b) => b.id);
  const neighbour = (b: (typeof list)[number] | null) => (b ? { href: billHref(b.id, from), label: `${b.sourceName} · ${b.invoiceNumber}` } : null);
  const at = (t: Tab) => `/app/vendor-bills/${inv.id}?${new URLSearchParams({ tab: t, from })}`;

  const campaigns: Record<string, string> = Object.fromEntries(sources.campaigns.map((c) => [c.id, c.name]));
  const period = billPeriod(inv.periodStart, inv.periodEnd);
  const differing = inv.comparison.rows.filter((r) => r.countable && r.differenceCents !== 0).length;
  const diff = s?.differenceCents ?? 0;
  const bookedMonths = [...new Set(inv.entries.filter((e) => !e.reverses).map((e) => billMonth(e.incurredOn).split(" ")[0]))];
  const statusNote =
    inv.status === "paid" ? [inv.paidOn ? `paid ${billDate(inv.paidOn)}` : "paid", inv.paidMethod ? `by ${PAID_METHOD_LABELS[inv.paidMethod]}` : null, inv.paymentReference ? `(${inv.paymentReference})` : null].filter(Boolean).join(" ")
    : inv.status === "void" ? `void${inv.voidReason ? `: ${inv.voidReason}` : ""}`
    : inv.status === "approved" ? [inv.approvedAt ? `approved ${billDate(inv.approvedAt)}` : "approved", inv.dueDate ? `due ${billDate(inv.dueDate)}` : null].filter(Boolean).join(" · ")
    : inv.status === "disputed" ? "waits on the vendor"
    : inv.dueDate ? `due ${billDate(inv.dueDate)}` : `dated ${billDate(inv.invoiceDate)}`;

  return (
    <AccountingPage
      step="bills"
      title={`${inv.sourceName} · ${inv.invoiceNumber}`}
      info="The bill line by line, set beside the leads you really got. Approving books its cost in the month each line belongs to; marking paid records when the money moved; voiding reverses it. Nothing is deleted."
      tabs={<ViewTabs label="This bill" value={tab} tabs={[
        { key: "lines", label: "Lines", count: inv.lines.length, href: at("lines") },
        { key: "count", label: "Compare to our count", count: differs ? differing || 1 : null, tone: "danger", href: at("count") },
        { key: "ledger", label: "Booked", count: inv.entries.length || null, href: at("ledger") },
        { key: "document", label: "Document", href: at("document") },
      ]} />}
      stepper={<RecordStepper noun="bill" previous={neighbour(previous)} next={neighbour(next)} />}
      actions={<>
        <InvoiceActions
          readOnly={readOnly}
          next={neighbour(next)}
          inv={{
            id: inv.id, status: inv.status, sourceName: inv.sourceName, sourceType: inv.sourceType, sourceId: inv.sourceId, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate,
            periodStart: inv.periodStart, taxCents: inv.taxCents, totalCents: inv.totalCents, hasDocument: inv.hasDocument, lines: inv.lines, booked: inv.entries.length > 0,
            differenceCents: s ? s.differenceCents : null, flagged: differs, toleranceCents: s?.toleranceCents ?? 0,
          }}
        />
      </>}
    >
      <StatStrip label="This bill">
        <StatTile label="Total" value={money(inv.totalCents)} footnote={`${inv.taxCents ? `incl. ${money(inv.taxCents)} tax` : "no tax"}${period ? ` · leads ${period}` : ""}`} href={at("lines")} />
        <StatTile label="Our count" value={s ? money(s.ourCents) : "—"} footnote={s ? "what you really got" : "nothing we can count"} href={at("count")} />
        <StatTile label={diff > 0 ? "Billed less by" : "Billed more by"} value={s ? money(Math.abs(diff)) : "—"} footnote={s ? (diff ? (differs ? <StatusChip tone="danger">Over the {money(s.toleranceCents)} you allow</StatusChip> : `you allow ${money(s.toleranceCents)}`) : "matches what you got") : "nothing we can count"} href={at("count")} />
        <StatTile label="Status" valueSize="text" value={<InvoiceStatusChip status={inv.status} />} footnote={statusNote} />
        <StatTile label="Booked in the P&L" valueSize="text" value={inv.entries.length ? "Yes" : "Not yet"} footnote={inv.entries.length ? `${inv.entries.length} cost entr${inv.entries.length === 1 ? "y" : "ies"}${bookedMonths.length ? `, ${bookedMonths.join(", ")}` : ""}` : "when you approve it"} href={at("ledger")} />
      </StatStrip>

      {tab === "count" ? (
        <BillCompare rows={inv.comparison.rows} lines={inv.lines} campaigns={campaigns} frozen={inv.comparison.frozen} invoicedCents={s?.invoicedCents ?? inv.subtotalCents} ourFigureCents={s ? s.ourCents : null} />
      ) : tab === "ledger" ? (
        <TableCard footer={inv.entries.length ? <div className="flex w-full justify-between text-xs text-muted-foreground"><span>An entry opens Profit &amp; loss for its month.</span><span>{inv.entries.length} entr{inv.entries.length === 1 ? "y" : "ies"}</span></div> : undefined}>
          {inv.entries.length === 0 ? <EmptyState title="Nothing booked yet" hint="Approving the bill books its cost, in the month each line belongs to." /> : (
            <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
              <thead><tr><th>Entry</th><th>For</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {inv.entries.map((e) => {
                  const pnl = `/app/pnl?${new URLSearchParams({ kind: "month", anchor: e.incurredOn.slice(0, 10), basis: "accrual" })}`;
                  // Owner 2026-11-11: one line, one colour. "· reversal" and the paid date became the row's one chip.
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap"><Link className="font-medium text-foreground hover:underline" href={pnl}>{e.description}</Link></td>
                      <td className="whitespace-nowrap text-muted-foreground">{billMonth(e.incurredOn)}</td>
                      <td className="whitespace-nowrap">{e.reverses ? <StatusChip tone="neutral">Reversal</StatusChip> : e.paidOn ? <StatusChip tone="good">Paid {billDate(e.paidOn)}</StatusChip> : <StatusChip tone="warning">Not paid yet</StatusChip>}</td>
                      <td className="whitespace-nowrap text-right tabular-nums"><Link className="hover:underline" href={pnl}>{money(e.amountCents)}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : tab === "document" ? (
        <BillDocument id={inv.id} name={inv.hasDocument ? inv.documentName ?? "The bill" : null} readOnly={readOnly} />
      ) : (
        <BillLines lines={inv.lines} campaigns={campaigns} totalCents={inv.totalCents} />
      )}
    </AccountingPage>
  );
}
