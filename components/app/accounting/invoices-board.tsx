"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog, confirmAction } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FactTable } from "@/components/ui/fact-table";
import { Field, control } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import {
  EDITABLE,
  INVOICE_STATUS_LABELS,
  invoiceTotals,
  LEAD_TYPE_LABELS,
  LEAD_TYPES,
  lineAmount,
  PAID_METHOD_LABELS,
  PAID_METHODS,
  templateInputs,
  type ComparisonRow,
  type InvoiceStatus,
  type InvoiceTemplate,
  type LeadType,
} from "@/lib/accounting/invoicesCore";
import { BILL_FORM_ACTIONS, billDate, billDiffers, billHref, billMonth, billNextStep, billPeriod, onBillTab, ourCents, sourceHref, type BillTab } from "@/lib/accounting/billTabs";
import type { InvoiceDetail, InvoiceListRow } from "@/lib/accounting/invoiceStore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.2 · what the agency paid for leads, one bill at a time. Each line carries its campaign; before approving,
 * the bill is set beside what we counted. Approving books the cost; marking paid records when the money moved;
 * voiding reverses — nothing is deleted.
 *
 * Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html, section 2, direction A "Status tabs"):
 *   - the list's views are the page's title-line tabs (billTabs.ts); a row is a link to its bill, and "Next step"
 *     says the step in words: the step itself is taken on the bill's page;
 *   - the bill page's title is the vendor and the number alone, its primary follows the status, and the
 *     difference is a red count on Compare to our count (a confirm when approving, never a card);
 *   - Enter a bill keeps its four questions, its Save buttons on the title line; a line is a row that opens the
 *     line dialog; From a monthly template is a dialog from the list's ⋯.
 * No side panel, nothing decided inside a row.
 */
type Named = { id: string; name: string };
type Sources = { vendors: Named[]; partners: Named[]; campaigns: (Named & { vendorId: string | null })[] };
type Template = InvoiceTemplate & { sourceName: string; lastUsedAt: string | null };

// One chip per row, its tone the meaning (owner 2026-11-11): waiting is warning, done is good, the rest neutral.
const TONE: Record<InvoiceStatus, StatusTone> = { draft: "neutral", received: "warning", disputed: "warning", approved: "warning", paid: "good", void: "neutral" };
/** A list row's next step as a short verb (owner 2026-11-11); billNextStep's sentence is its tooltip. */
const NEXT_VERB: Partial<Record<InvoiceStatus, string>> = { draft: "Finish", received: "Approve", disputed: "Close dispute", approved: "Mark paid" };
const money = (cents: number | null | undefined) => (cents == null ? "—" : formatCentsAsCurrency(cents));
const today = () => new Date().toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** Cents as a dollar string for an input, by string handling alone (no float). */
const dollars = (cents: number) => {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
const READ_ONLY_REASON = "Your plan is read-only: bills can be seen, not entered or changed.";
/** The leads behind a campaign's line. Leads has no campaign-and-period filter yet, so this is the campaign's own page. */
const campaignHref = (id: string) => `/app/campaigns/${id}`;

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

export function InvoiceStatusChip({ status, paidOn }: { status: InvoiceStatus; paidOn?: string | null }) {
  return <StatusChip tone={TONE[status]}>{INVOICE_STATUS_LABELS[status]}{status === "paid" && paidOn ? ` ${billDate(paidOn)}` : ""}</StatusChip>;
}

/** A button that is off, with the reason on hover (2·8: read-only states draw no card). */
function OffButton({ reason, children, variant }: { reason: string; children: ReactNode; variant?: "outline" }) {
  return <span title={reason} className="inline-flex"><Button type="button" variant={variant} disabled>{children}</Button></span>;
}

/** The chevron that ends a row which opens something. */
const Chevron = () => <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />;
const rowClass = "cursor-pointer hover:bg-[var(--surface-alt)]";

// ─── Enter a bill ───────────────────────────────────────────────────────────────────────────────

type LineDraft = { description: string; campaignId: string; leadType: LeadType; quantity: string; unitPrice: string; amount: string };
const blankLine = (): LineDraft => ({ description: "", campaignId: "", leadType: "live_transfer", quantity: "", unitPrice: "", amount: "" });

function parsedLine(l: LineDraft) {
  const quantity = l.quantity.trim() === "" ? 0 : Number(l.quantity);
  const unit = l.unitPrice.trim() === "" ? 0 : parseDollarsToCents(l.unitPrice);
  const amount = l.amount.trim() === "" ? null : parseDollarsToCents(l.amount);
  return { quantity, unitPriceCents: unit, amountCents: amount };
}
const lineTotal = (l: LineDraft) => {
  const p = parsedLine(l);
  return p.unitPriceCents === null ? null : lineAmount({ quantity: p.quantity, unitPriceCents: p.unitPriceCents, amountCents: p.amountCents });
};

/** /app/vendor-bills/new: enter a bill, or edit one that can still change (`initial`). */
export function InvoiceEntry({ sources, initial }: { sources: Sources; initial?: InvoiceDetail }) {
  return <InvoiceForm sources={sources} initial={initial} />;
}

function InvoiceForm({ sources, initial }: { sources: Sources; initial?: InvoiceDetail }) {
  const router = useRouter();
  const start = () => ({
    source: initial ? `${initial.sourceType}:${initial.sourceId}` : "",
    number: initial?.invoiceNumber ?? "",
    date: initial?.invoiceDate ?? today(),
    periodStart: initial?.periodStart ?? "",
    periodEnd: initial?.periodEnd ?? "",
    due: initial?.dueDate ?? "",
    tax: initial ? dollars(initial.taxCents) : "",
    note: initial?.note ?? "",
  });
  const startLines = (): LineDraft[] => initial?.lines.map((l) => ({
    description: l.description, campaignId: l.campaignId ?? "", leadType: l.leadType, quantity: String(l.quantity), unitPrice: dollars(l.unitPriceCents),
    amount: l.amountCents === l.quantity * l.unitPriceCents ? "" : dollars(l.amountCents),
  })) ?? [];
  const [f, setF] = useState(start);
  const [lines, setLines] = useState<LineDraft[]>(startLines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: "source" | "number" | "period" | "lines" | "tax" | null; message: string } | null>(null);
  const [editing, setEditing] = useState<number | "new" | "tax" | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(BILL_FORM_ACTIONS)); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  const scope = useRef<HTMLFormElement>(null);
  const set = (k: keyof ReturnType<typeof start>, v: string) => { setF((cur) => ({ ...cur, [k]: v })); setError(null); };
  const dirty = JSON.stringify(f) !== JSON.stringify(start()) || JSON.stringify(lines) !== JSON.stringify(startLines());
  const discard = () => { setF(start()); setLines(startLines()); };

  const parsed = lines.map(parsedLine);
  const taxCents = f.tax.trim() === "" ? 0 : parseDollarsToCents(f.tax);
  const totals = taxCents !== null && parsed.every((p) => p.unitPriceCents !== null) ? invoiceTotals(parsed.map((p) => ({ quantity: p.quantity, unitPriceCents: p.unitPriceCents ?? 0, amountCents: p.amountCents })), taxCents) : null;
  const unattributed = lines.filter((l) => !l.campaignId).length;
  const periodWrong = Boolean(f.periodStart && f.periodEnd && f.periodEnd < f.periodStart);

  // "Save as draft" keeps it to finish later; "Save bill" means it arrived and is ready to check and approve.
  const save = async (as: "draft" | "received" = "received"): Promise<boolean> => {
    if (!f.source) { setError({ field: "source", message: "Choose who sent the bill." }); return false; }
    if (!f.number.trim()) { setError({ field: "number", message: "Enter the bill number, as printed on the bill." }); return false; }
    if (periodWrong) { setError({ field: "period", message: "“Leads to” is before “Leads from”." }); return false; }
    if (!lines.length) { setError({ field: "lines", message: "Add at least one line." }); return false; }
    if (!totals || taxCents === null) { setError({ field: "tax", message: "Dollars and cents only." }); return false; }
    const [kind, id] = f.source.split(":");
    setBusy(true);
    setError(null);
    try {
      const payload = {
        vendor_id: kind === "vendor" ? id : null, partner_id: kind === "partner" ? id : null, invoice_number: f.number, invoice_date: f.date,
        period_start: f.periodStart || null, period_end: f.periodEnd || null, due_date: f.due || null, tax_cents: taxCents, note: f.note || null, status: as,
        lines: lines.map((l, i) => ({ description: l.description, campaign_id: l.campaignId || null, lead_type: l.leadType, quantity: parsed[i].quantity, unit_price_cents: parsed[i].unitPriceCents ?? 0, amount_cents: parsed[i].amountCents })),
      };
      const body = initial
        ? await send(`/api/app/accounting/invoices/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await send("/api/app/accounting/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      notify.done(as === "draft" ? "Saved as a draft. Finish it when you have the details." : "Bill saved. Check it against your count, then approve it.");
      router.push(`/app/vendor-bills/${initial?.id ?? body.id}`);
      router.refresh();
      return true;
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };
  const leave = () => { discard(); router.push(initial ? `/app/vendor-bills/${initial.id}` : "/app/vendor-bills"); };

  const vendorId = f.source.startsWith("vendor:") ? f.source.slice(7) : null;
  const campaigns = vendorId ? sources.campaigns.filter((c) => c.vendorId === vendorId || !c.vendorId) : sources.campaigns;
  const campaignName = (cid: string) => sources.campaigns.find((c) => c.id === cid)?.name ?? "Campaign";
  const heading = "m-0 text-base font-semibold text-[var(--ink)]";
  const card = `${cardSurface} flex flex-col gap-3 p-4`;
  const editingLine = typeof editing === "number" ? lines[editing] : editing === "new" ? blankLine() : null;

  const buttons = (
    <>
      <Button type="button" variant="ghost" disabled={busy} onClick={leave}>Discard</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void save("draft")}>Save as draft</Button>
      <Button type="submit" form="bill-form" disabled={busy}>{busy ? "Saving…" : initial ? "Save changes" : "Save bill"}</Button>
    </>
  );

  return (
    <form id="bill-form" ref={scope} onSubmit={submit} className="flex flex-col gap-4">
      {slot ? createPortal(buttons, slot) : <div className="flex justify-end gap-2">{buttons}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className={heading}>1 · Who sent the bill?</h2>
          <Field label="Vendor or partner" htmlFor="inv-source" required error={error?.field === "source" ? error.message : undefined}>
            <select id="inv-source" className={control} required value={f.source} onChange={(e) => set("source", e.target.value)}>
              <option value="">Choose who sent it</option>
              {sources.vendors.length ? <optgroup label="Lead vendors">{sources.vendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.name}</option>)}</optgroup> : null}
              {sources.partners.length ? <optgroup label="Partners">{sources.partners.map((p) => <option key={p.id} value={`partner:${p.id}`}>{p.name}</option>)}</optgroup> : null}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bill number" htmlFor="inv-number" required error={error?.field === "number" ? error.message : undefined}><input id="inv-number" className={control} required maxLength={80} placeholder="As printed on the bill" value={f.number} onChange={(e) => set("number", e.target.value)} /></Field>
            <Field label="Bill date" htmlFor="inv-date" required><input id="inv-date" type="date" className={control} required value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
          </div>
        </section>

        <section className={card}>
          <h2 className={heading}>2 · Which leads does it cover?</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Leads from" htmlFor="inv-from"><input id="inv-from" type="date" className={control} value={f.periodStart} onChange={(e) => set("periodStart", e.target.value)} /></Field>
            <Field label="Leads to" htmlFor="inv-to" error={periodWrong ? "“Leads to” is before “Leads from”." : undefined}><input id="inv-to" type="date" className={control} aria-invalid={periodWrong || undefined} value={f.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} /></Field>
            <Field label="Pay by (optional)" htmlFor="inv-due"><input id="inv-due" type="date" className={control} value={f.due} onChange={(e) => set("due", e.target.value)} /></Field>
          </div>
          <p className="m-0 text-xs text-muted-foreground">Used to compare the bill with the leads you really got.</p>
        </section>
      </div>

      <section className={`${cardSurface} flex flex-col`}>
        <div className="flex items-center justify-between gap-3 p-4 pb-3">
          <h2 className={heading}>3 · What is on it?</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>Add a line</Button>
        </div>
        {lines.length === 0 ? (
          <EmptyState title="No lines yet" hint={error?.field === "lines" ? error.message : "Add each line as the bill lists it: what it is, its campaign, how many and the price each."} action={<Button type="button" variant="outline" onClick={() => setEditing("new")}>Add a line</Button>} />
        ) : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th>What</th><th>Campaign</th><th>Kind of lead</th><th className="text-right">How many</th><th className="text-right">Each</th><th className="text-right">Line total</th><th className="w-[40px]"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className={rowClass} onClick={() => setEditing(i)}>
                  <td className="whitespace-nowrap"><button type="button" className="text-left font-medium text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); setEditing(i); }}>{l.description || "Line"}</button></td>
                  <td className="whitespace-nowrap">{l.campaignId ? campaignName(l.campaignId) : <StatusChip tone="warning" title="Won't count toward a campaign's cost">No campaign</StatusChip>}</td>
                  <td className="whitespace-nowrap">{LEAD_TYPE_LABELS[l.leadType]}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{Number(l.quantity || 0).toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(parsedLine(l).unitPriceCents)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(lineTotal(l))}</td>
                  <td><Chevron /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
          <span className="text-xs text-muted-foreground">{unattributed ? `${plural(unattributed, "line")} with no campaign won't count toward a campaign's cost.` : lines.length ? "Every line is tied to a campaign." : ""}</span>
          <span className="tabular-nums">
            <button type="button" className="text-[var(--accent-ink)] hover:underline" onClick={() => setEditing("tax")}>Tax {money(taxCents ?? 0)}</button>
            {totals ? <><span className="text-muted-foreground"> · Subtotal {money(totals.subtotalCents)} · </span><strong className="text-foreground">Total {money(totals.totalCents)}</strong></> : <span className="text-[var(--error-ink)]"> · Dollars and cents only.</span>}
          </span>
        </div>
      </section>

      <section className={card}>
        <h2 className={heading}>4 · Anything else? <span className="font-normal text-muted-foreground">(optional)</span></h2>
        <Field label="Note" htmlFor="inv-note"><input id="inv-note" className={control} maxLength={2000} placeholder="Only you see this" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
      </section>

      {editingLine ? (
        <LineDialog
          key={String(editing)}
          line={editingLine}
          place={typeof editing === "number" ? `line ${editing + 1} of ${lines.length}` : null}
          campaigns={campaigns}
          onClose={() => setEditing(null)}
          onSave={(next) => { setLines((cur) => (typeof editing === "number" ? cur.map((l, j) => (j === editing ? next : l)) : [...cur, next])); setEditing(null); setError(null); }}
          onRemove={typeof editing === "number" ? () => { setLines((cur) => cur.filter((_, j) => j !== editing)); setEditing(null); } : undefined}
        />
      ) : null}
      {editing === "tax" ? <TaxDialog value={f.tax} onClose={() => setEditing(null)} onSave={(v) => { set("tax", v); setEditing(null); }} /> : null}
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={() => save("draft")} onDiscard={discard} what="this bill" />
    </form>
  );
}

/** A line of the bill (2·4): add, change or remove it. "Dollars and cents only." under a price it can't read. */
function LineDialog({ line, place, campaigns, onClose, onSave, onRemove }: {
  line: LineDraft;
  place: string | null;
  campaigns: (Named & { vendorId: string | null })[];
  onClose: () => void;
  onSave: (line: LineDraft) => void;
  onRemove?: () => void;
}) {
  const [l, setL] = useState<LineDraft>(line);
  const [tried, setTried] = useState(false);
  const set = (k: keyof LineDraft, v: string) => setL((cur) => ({ ...cur, [k]: v }));
  const p = parsedLine(l);
  const unitBad = (l.unitPrice.trim() !== "" && p.unitPriceCents === null) || (p.unitPriceCents ?? 0) < 0;
  const amountBad = l.amount.trim() !== "" && (p.amountCents === null || p.amountCents < 0);
  const missing = !l.description.trim();
  const ok = !unitBad && !amountBad && !missing;
  const save = (e: FormEvent) => { e.preventDefault(); setTried(true); if (ok) onSave({ ...l, description: l.description.trim() }); };
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{line.description || (place ? "Line" : "Add a line")}</DialogTitle>
            <DialogDescription>{place ?? "What the bill lists, its campaign, how many and the price each."}</DialogDescription>
          </DialogHeader>
          <Field label="What" htmlFor="line-what" required error={tried && missing ? "Say what this line is for." : undefined}><input id="line-what" className={control} autoFocus maxLength={300} placeholder="e.g. Live transfers, final expense" value={l.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Campaign" htmlFor="line-campaign"><select id="line-campaign" className={control} value={l.campaignId} onChange={(e) => set("campaignId", e.target.value)}><option value="">No campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Kind of lead" htmlFor="line-kind"><select id="line-kind" className={control} value={l.leadType} onChange={(e) => set("leadType", e.target.value)}>{LEAD_TYPES.map((t) => <option key={t} value={t}>{LEAD_TYPE_LABELS[t]}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How many" htmlFor="line-qty"><input id="line-qty" className={`${control} text-right tabular-nums`} inputMode="numeric" value={l.quantity} onChange={(e) => set("quantity", e.target.value.replace(/[^\d]/g, ""))} /></Field>
            <Field label="Each ($)" htmlFor="line-each" error={unitBad ? "Dollars and cents only." : undefined}><input id="line-each" className={`${control} text-right tabular-nums`} inputMode="decimal" aria-invalid={unitBad || undefined} value={l.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} /></Field>
          </div>
          <Field label="Line total ($, only when the bill shows another figure)" htmlFor="line-total" error={amountBad ? "Dollars and cents only." : undefined}>
            <input id="line-total" className={`${control} text-right tabular-nums`} inputMode="decimal" aria-invalid={amountBad || undefined} placeholder={p.unitPriceCents != null ? dollars(lineAmount({ quantity: p.quantity, unitPriceCents: p.unitPriceCents, amountCents: null })) : ""} value={l.amount} onChange={(e) => set("amount", e.target.value)} />
          </Field>
          <DialogFooter className="sm:justify-between">
            {onRemove ? <Button type="button" variant="ghost" className="text-[var(--error-ink)]" onClick={onRemove}>Remove the line</Button> : <span />}
            <span className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={unitBad || amountBad}>Save line</Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaxDialog({ value, onClose, onSave }: { value: string; onClose: () => void; onSave: (value: string) => void }) {
  const [v, setV] = useState(value);
  const bad = v.trim() !== "" && (parseDollarsToCents(v) === null || (parseDollarsToCents(v) ?? 0) < 0);
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md">
        <form onSubmit={(e) => { e.preventDefault(); if (!bad) onSave(v.trim()); }} className="grid gap-4">
          <DialogHeader><DialogTitle>Tax on the bill</DialogTitle><DialogDescription>As printed on the bill. Leave it empty when there is none.</DialogDescription></DialogHeader>
          <Field label="Tax ($)" htmlFor="inv-tax" error={bad ? "Dollars and cents only." : undefined}><input id="inv-tax" className={`${control} text-right tabular-nums`} autoFocus inputMode="decimal" placeholder="0.00" value={v} onChange={(e) => setV(e.target.value)} /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={bad}>Save tax</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** ⋯ From a monthly template (2·4): three fields or fewer, the rest from the template; saved as received. */
function FromTemplate({ templates, initialId, onClose }: { templates: Template[]; initialId?: string; onClose: () => void }) {
  const router = useRouter();
  const [list, setList] = useState(templates);
  const [templateId, setTemplateId] = useState(list.find((x) => x.id === initialId)?.id ?? list[0]?.id ?? "");
  const t = list.find((x) => x.id === templateId);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  const perUnit = t ? t.lines.filter((l) => l.amountCents == null) : [];
  const dirty = Boolean(number || qty.some(Boolean));
  const save = async (): Promise<boolean> => {
    if (!number.trim()) { setError("Enter the bill number, as printed on the bill."); return false; }
    setBusy(true);
    setError(null);
    try {
      const body = await send("/api/app/accounting/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: templateId, invoice_number: number, invoice_date: date, quantities: perUnit.map((_, i) => Number(qty[i] || 0)) }) });
      notify.done("Bill saved. Check it against your count, then approve it.");
      router.push(`/app/vendor-bills/${body.id}`);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!t || !(await confirmAction({ title: `Delete the template “${t.name}”?`, description: "Bills already entered from it stay as they are.", confirmLabel: "Delete template", cancelLabel: "Keep template" }))) return;
    setBusy(true);
    try {
      await send(`/api/app/accounting/invoice-templates?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
      notify.done("Template deleted");
      const rest = list.filter((x) => x.id !== t.id);
      setList(rest);
      setTemplateId(rest[0]?.id ?? "");
      setQty([]);
      router.refresh();
      if (!rest.length) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The template wasn't deleted");
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      {/* The dialog's width (560, UI-CONSISTENCY §11), not a control's height: written so §5's tall-control count does not read it as one. */}
      <DialogContent size={"lg"}>
        <form ref={scope} onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Enter a bill from a template</DialogTitle>
            <DialogDescription>{t ? `${plural(templateInputs(t).length, "field")}: the rest comes from the template. The period is the month before the bill date.` : "No monthly template yet: save one from a bill's ⋯."}</DialogDescription>
          </DialogHeader>
          <Field label="Template" htmlFor="tpl-pick">
            <select id="tpl-pick" className={control} value={templateId} onChange={(e) => { setTemplateId(e.target.value); setQty([]); }}>{list.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.sourceName}</option>)}</select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bill number" htmlFor="tpl-number" required error={error && !number.trim() ? error : undefined}><input id="tpl-number" className={control} required maxLength={80} value={number} onChange={(e) => { setNumber(e.target.value); setError(null); }} autoFocus /></Field>
            <Field label="Bill date" htmlFor="tpl-date" required><input id="tpl-date" type="date" className={control} required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          {perUnit.map((l, i) => (
            <Field key={`${templateId}-${i}`} label={`${l.description}: how many`} htmlFor={`tpl-qty-${i}`} required><input id={`tpl-qty-${i}`} className={`${control} text-right tabular-nums`} required inputMode="numeric" value={qty[i] ?? ""} onChange={(e) => setQty((cur) => { const next = [...cur]; next[i] = e.target.value.replace(/[^\d]/g, ""); return next; })} /></Field>
          ))}
          {error && number.trim() ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" disabled={busy || !t} onClick={() => void remove()}>Delete this template</Button>
            <span className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy || !t}>{busy ? "Saving…" : "Enter the bill"}</Button>
            </span>
          </DialogFooter>
          <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => { setNumber(""); setQty([]); }} what="this bill" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The list's title line (2·A): ⋯ with From a monthly template, and Enter a bill. `openTemplate` opens the dialog on arrival. */
export function InvoiceListActions({ templates, readOnly, openTemplate }: { templates: Template[]; readOnly: boolean; openTemplate?: string }) {
  const [asked, setAsked] = useState<string | null>(!readOnly && templates.length && openTemplate ? (openTemplate === "first" ? templates[0].id : openTemplate) : null);
  return (
    <>
      <MoreMenu items={[templates.length > 0 && !readOnly && { label: "From a monthly template", onSelect: () => setAsked(templates[0].id) }]} />
      {readOnly ? <OffButton reason={READ_ONLY_REASON}>Enter a bill</OffButton> : <Button asChild><Link href="/app/vendor-bills/new">Enter a bill</Link></Button>}
      {asked ? <FromTemplate templates={templates} initialId={asked} onClose={() => setAsked(null)} /> : null}
    </>
  );
}

// ─── A bill's page ──────────────────────────────────────────────────────────────────────────────

type Head = Pick<InvoiceDetail, "id" | "status" | "sourceName" | "sourceType" | "sourceId" | "invoiceNumber" | "invoiceDate" | "periodStart" | "taxCents" | "totalCents" | "hasDocument" | "lines"> & {
  booked: boolean;
  /** Our count against the bill now: our figure less the bill, and whether it is past the tolerance. */
  differenceCents: number | null;
  flagged: boolean;
  toleranceCents: number;
};
type Asking = { kind: "paid"; on: string; method: string; reference: string } | { kind: "dispute"; note: string } | { kind: "void"; reason: string; tried: boolean } | { kind: "approve" } | { kind: "undispute" };

/**
 * A bill page's title line (2·1, 2·5): ⋯ (Edit while it can change, Dispute, Save as a monthly template, Attach the
 * bill / Open the document, Void), then the one primary its status calls for — Finish (draft), Approve (received),
 * Mark paid (approved), Close the dispute (disputed); none once paid or void. Approving a bill that differs past
 * the tolerance asks first (was a warning card). `next` is the following bill in the list it was opened from.
 */
export function InvoiceActions({ inv, readOnly, next }: { inv: Head; readOnly: boolean; next?: { href: string; label: string } | null }) {
  const router = useRouter();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const editable = EDITABLE.includes(inv.status);
  const act = async (payload: Record<string, unknown>, done: (r: unknown) => string, after?: { label: string; onClick: () => void }) => {
    setBusy(true);
    try {
      const body = await send(`/api/app/accounting/invoices/${inv.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      notify.done(done(body.result), after ? { action: after } : undefined);
      setAsking(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const approve = () => act({ action: "approve" }, (r) => { const x = r as { entries: number }; return `Approved: ${plural(x.entries, "cost entry", "cost entries")} booked`; });
  const upload = useUpload(inv.id);
  const saveTemplate = async () => {
    setBusy(true);
    try {
      await send("/api/app/accounting/invoice-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${inv.sourceName} monthly`, vendor_id: inv.sourceType === "vendor" ? inv.sourceId : null, partner_id: inv.sourceType === "partner" ? inv.sourceId : null, tax_cents: inv.taxCents,
          lines: inv.lines.map((l) => ({ description: l.description, campaign_id: l.campaignId, lead_type: l.leadType, unit_price_cents: l.unitPriceCents, amount_cents: l.amountCents === l.quantity * l.unitPriceCents ? null : l.amountCents })),
        }),
      });
      notify.done("Saved as a monthly template");
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "The template didn't save");
    } finally {
      setBusy(false);
    }
  };
  const documentItem = inv.hasDocument ? { label: "Open the document", href: `/api/app/accounting/invoices/${inv.id}/document` } : null;
  const gap = inv.differenceCents == null ? 0 : Math.abs(inv.differenceCents);
  const primaryLabel = inv.status === "draft" ? "Finish" : inv.status === "received" ? "Approve" : inv.status === "approved" ? "Mark paid" : inv.status === "disputed" ? "Close the dispute" : null;
  if (readOnly) return <><MoreMenu items={[documentItem]} />{primaryLabel ? <OffButton reason={READ_ONLY_REASON}>{primaryLabel}</OffButton> : null}</>;
  return (
    <>
      <MoreMenu items={[
        editable && { label: "Edit", href: `/app/vendor-bills/new?edit=${inv.id}` },
        inv.status === "received" && { label: "Dispute", onSelect: () => setAsking({ kind: "dispute", note: "" }) },
        { label: "Save as a monthly template", onSelect: () => void saveTemplate(), disabled: busy },
        inv.hasDocument ? documentItem : { label: "Attach the bill", onSelect: () => picker.current?.click() },
        inv.status !== "void" && { label: "Void", onSelect: () => setAsking({ kind: "void", reason: "", tried: false }) },
      ]} />
      {inv.status === "draft" ? <Button asChild><Link href={`/app/vendor-bills/new?edit=${inv.id}`}>Finish</Link></Button> : null}
      {inv.status === "received" ? <Button disabled={busy} onClick={() => (inv.flagged ? setAsking({ kind: "approve" }) : void approve())}>Approve</Button> : null}
      {inv.status === "approved" ? <Button disabled={busy} onClick={() => setAsking({ kind: "paid", on: today(), method: "ach", reference: "" })}>Mark paid</Button> : null}
      {inv.status === "disputed" ? <Button disabled={busy} onClick={() => setAsking({ kind: "undispute" })}>Close the dispute</Button> : null}
      <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
      {asking?.kind === "approve" ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setAsking(null); }}
          busy={busy}
          destructive={false}
          title={`Approve ${inv.invoiceNumber} with a ${money(gap)} difference?`}
          description={`Your count is ${money(gap)} ${(inv.differenceCents ?? 0) < 0 ? "under" : "over"} the bill, beyond your ${money(inv.toleranceCents)} tolerance. Approving books ${money(inv.totalCents)} in ${billMonth(inv.periodStart ?? inv.invoiceDate)}.`}
          confirmLabel="Approve"
          cancelLabel="Check it first"
          onConfirm={() => void approve()}
        />
      ) : asking?.kind === "undispute" ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setAsking(null); }}
          busy={busy}
          destructive={false}
          title={`Close the dispute on ${inv.invoiceNumber}?`}
          description={`It goes back to To approve. Edit it first if ${inv.sourceName} sent a corrected bill.`}
          confirmLabel="Close the dispute"
          cancelLabel="Keep it disputed"
          onConfirm={() => void act({ action: "undispute" }, () => "Dispute closed. Check the bill, then approve it.")}
        />
      ) : asking ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setAsking(null); }}
          busy={busy}
          destructive={asking.kind === "void"}
          title={asking.kind === "paid" ? `Mark ${inv.invoiceNumber} paid?` : asking.kind === "dispute" ? `Dispute ${inv.invoiceNumber}?` : `Void ${inv.invoiceNumber}?`}
          description={asking.kind === "paid" ? "Records when the money moved. Nothing is paid from here." : asking.kind === "dispute" ? "It stays unapproved until the dispute is closed." : inv.booked ? "The booked cost is reversed; the original entries stay on record." : "Nothing has been booked yet; the bill stays on record as void."}
          confirmLabel={asking.kind === "paid" ? "Record payment" : asking.kind === "dispute" ? "Dispute bill" : "Void bill"}
          cancelLabel="Keep it"
          confirmDisabled={asking.kind === "paid" ? !asking.on : false}
          onConfirm={() => {
            if (asking.kind === "paid") void act({ action: "paid", paid_on: asking.on, method: asking.method, reference: asking.reference.trim() || null }, () => "Marked paid", next ? { label: "Next bill ›", onClick: () => router.push(next.href) } : undefined);
            else if (asking.kind === "dispute") void act({ action: "dispute", note: asking.note.trim() || null }, () => "Disputed. It waits on the vendor until you close the dispute.");
            else if (!asking.reason.trim()) setAsking({ ...asking, tried: true });
            else void act({ action: "void", reason: asking.reason.trim() }, (r) => (Number(r) ? `Voided: ${plural(Number(r), "entry", "entries")} reversed` : "Voided"));
          }}
          fields={asking.kind === "paid" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Paid on" htmlFor="inv-paid-on"><input id="inv-paid-on" type="date" className={control} value={asking.on} onChange={(e) => setAsking({ ...asking, on: e.target.value })} /></Field>
                <Field label="Method" htmlFor="inv-method"><select id="inv-method" className={control} value={asking.method} onChange={(e) => setAsking({ ...asking, method: e.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field>
              </div>
              <Field label="Reference on the bank statement" htmlFor="inv-ref"><input id="inv-ref" className={control} maxLength={200} value={asking.reference} onChange={(e) => setAsking({ ...asking, reference: e.target.value })} /></Field>
            </>
          ) : asking.kind === "dispute" ? (
            <Field label="Why are you disputing it?" htmlFor="inv-dispute"><input id="inv-dispute" className={control} autoFocus maxLength={2000} value={asking.note} onChange={(e) => setAsking({ ...asking, note: e.target.value })} placeholder="For example: 28 leads rejected at the gate" /></Field>
          ) : (
            <Field label="Why is it void?" htmlFor="inv-void" required error={asking.tried && !asking.reason.trim() ? "Say why it is void." : undefined}><input id="inv-void" className={control} autoFocus maxLength={500} aria-invalid={(asking.tried && !asking.reason.trim()) || undefined} value={asking.reason} onChange={(e) => setAsking({ ...asking, reason: e.target.value })} /></Field>
          )}
        />
      ) : null}
    </>
  );
}

/** Attach the bill's document (a PDF or a photo); the page refreshes to show it. */
function useUpload(id: string) {
  const router = useRouter();
  return async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    try {
      await send(`/api/app/accounting/invoices/${id}/document`, { method: "POST", body: form });
      notify.done("Bill attached");
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "The file didn't upload");
    }
  };
}

type LineRow = InvoiceDetail["lines"][number];
type CampaignName = Record<string, string>;

/** Lines (2·2): read-only; a row opens the line's facts. */
export function BillLines({ lines, campaigns, totalCents }: { lines: LineRow[]; campaigns: CampaignName; totalCents: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const l = open === null ? null : lines[open];
  const unattributed = lines.filter((x) => !x.campaignId);
  const unattributedCents = unattributed.reduce((s, x) => s + x.amountCents, 0);
  return (
    <TableCard footer={<div className="flex w-full flex-wrap justify-between gap-3 text-xs text-muted-foreground"><span>{unattributed.length ? `${plural(unattributed.length, "line")} (${money(unattributedCents)}) not attributed to a campaign: counted in your costs, not in any campaign's cost per policy.` : "Every line is tied to a campaign."}</span><span className="tabular-nums">Total {money(totalCents)}</span></div>}>
      <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
        <thead><tr><th>Line</th><th>Campaign</th><th>Kind of lead</th><th className="text-right">How many</th><th className="text-right">Each</th><th className="text-right">Amount</th><th className="w-[40px]"><span className="sr-only">Open</span></th></tr></thead>
        <tbody>
          {lines.map((x, i) => (
            <tr key={x.id} className={rowClass} onClick={() => setOpen(i)}>
              <td className="whitespace-nowrap"><button type="button" className="text-left font-medium text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(i); }}>{x.description}</button></td>
              <td className="whitespace-nowrap">{x.campaignId ? <Link className="hover:underline" href={campaignHref(x.campaignId)} onClick={(e) => e.stopPropagation()}>{campaigns[x.campaignId] ?? "Campaign"}</Link> : <StatusChip tone="warning" title="Counted in your costs, not in any campaign's cost per policy">No campaign</StatusChip>}</td>
              <td className="whitespace-nowrap">{LEAD_TYPE_LABELS[x.leadType]}</td>
              <td className="whitespace-nowrap text-right tabular-nums">{x.quantity.toLocaleString("en-US")}</td>
              <td className="whitespace-nowrap text-right tabular-nums">{money(x.unitPriceCents)}</td>
              <td className="whitespace-nowrap text-right tabular-nums">{money(x.amountCents)}</td>
              <td><Chevron /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={l !== null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent size="md">
          {l ? <>
            <DialogHeader><DialogTitle>{l.description}</DialogTitle><DialogDescription>{`line ${(open ?? 0) + 1} of ${lines.length}`}</DialogDescription></DialogHeader>
            <FactTable rows={[
              ["Campaign", l.campaignId ? <Link className="text-[var(--accent-ink)] hover:underline" href={campaignHref(l.campaignId)}>{campaigns[l.campaignId] ?? "Campaign"}</Link> : "No campaign"],
              ["Kind of lead", LEAD_TYPE_LABELS[l.leadType]],
              ["Leads for", billPeriod(l.periodStart ?? null, l.periodEnd ?? null)],
              ["How many", l.quantity.toLocaleString("en-US")],
              ["Each", money(l.unitPriceCents)],
              ["Amount", money(l.amountCents)],
            ]} />
            <DialogFooter showCloseButton />
          </> : null}
        </DialogContent>
      </Dialog>
    </TableCard>
  );
}

/** Compare to our count (2·1): a row per line; a row opens its count (2·4), with the way to those leads. */
export function BillCompare({ rows, lines, campaigns, frozen, invoicedCents, ourFigureCents }: { rows: ComparisonRow[]; lines: LineRow[]; campaigns: CampaignName; frozen: boolean; invoicedCents: number; ourFigureCents: number | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const r = open ? rows.find((x) => x.lineId === open) ?? null : null;
  const lineOf = (id: string) => lines.find((l) => l.id === id);
  const name = (row: ComparisonRow) => lineOf(row.lineId)?.description ?? LEAD_TYPE_LABELS[row.leadType];
  const invoiced = (row: ComparisonRow) => `${row.invoicedQuantity.toLocaleString("en-US")} × ${money(row.unitPriceCents)} = ${money(row.invoicedCents)}`;
  const gap = (row: ComparisonRow) => (row.differenceCents < 0 ? `${money(-row.differenceCents)} more than you got` : row.differenceCents > 0 ? `${money(row.differenceCents)} less than you got` : "Matches what you got");
  return (
    <TableCard footer={<div className="flex w-full flex-wrap justify-between gap-3 text-xs text-muted-foreground"><span>{frozen ? "As at approval. " : ""}Lines we can&apos;t count read &ldquo;Not counted&rdquo;: the bill&apos;s figure is used.</span><span className="tabular-nums">{money(invoicedCents)} billed · {money(ourFigureCents)} our figure</span></div>}>
      {rows.length === 0 ? <EmptyState title="Nothing to compare" hint="The bill has no lines yet." /> : (
        <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead><tr><th>Line</th><th className="text-right">Invoiced</th><th className="text-right">We recorded</th><th className="text-right">Rejected</th><th className="text-right">Credits</th><th className="text-right">Our figure</th><th>Difference</th><th className="w-[40px]"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const none = <span className="text-muted-foreground">—</span>;
              return (
                <tr key={row.lineId} className={rowClass} onClick={() => setOpen(row.lineId)}>
                  {/* The campaign (was a second line) is the tooltip and the dialog's subtitle. */}
                  <td className="whitespace-nowrap"><button type="button" className="text-left font-medium text-foreground hover:underline" title={row.campaignId ? `Campaign ${campaigns[row.campaignId] ?? ""}` : "No campaign"} onClick={(e) => { e.stopPropagation(); setOpen(row.lineId); }}>{name(row)}</button></td>
                  <td className="whitespace-nowrap text-right tabular-nums">{invoiced(row)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{!row.countable ? none : row.campaignId ? <Link className="hover:underline" href={campaignHref(row.campaignId)} onClick={(e) => e.stopPropagation()}>{row.recorded.toLocaleString("en-US")}</Link> : row.recorded.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{row.countable ? row.rejected.toLocaleString("en-US") : none}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{row.countable ? money(row.creditedCents) : none}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{row.countable ? money(row.ourCents) : none}</td>
                  <td className="whitespace-nowrap">{!row.countable
                    ? <StatusChip tone="neutral" title="Not something we can count: the bill's figure is used">Not counted</StatusChip>
                    : row.differenceCents < 0 ? <StatusChip tone="danger" title={gap(row)}>{money(-row.differenceCents)} over</StatusChip>
                    : row.differenceCents > 0 ? <StatusChip tone="neutral" title={gap(row)}>{money(row.differenceCents)} under</StatusChip>
                    : <StatusChip tone="good">Matches</StatusChip>}</td>
                  <td><Chevron /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Dialog open={r !== null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent size="md">
          {r ? <>
            <DialogHeader>
              <DialogTitle>{name(r)}</DialogTitle>
              <DialogDescription>{[r.campaignId ? `Campaign ${campaigns[r.campaignId] ?? ""}` : "No campaign", billPeriod(r.periodFrom, r.periodTo)].filter(Boolean).join(" · ")}</DialogDescription>
            </DialogHeader>
            <FactTable rows={r.countable ? [
              ["Invoiced", invoiced(r)],
              ["We recorded", r.campaignId ? <Link className="text-[var(--accent-ink)] hover:underline" href={campaignHref(r.campaignId)}>{plural(r.recorded, "lead")}</Link> : plural(r.recorded, "lead")],
              ["Rejected", r.rejected.toLocaleString("en-US")],
              ["Credits", r.creditedCount ? `${plural(r.creditedCount, "lead")} · ${money(r.creditedCents)}` : money(0)],
              ["Our figure", money(r.ourCents)],
              ["Difference", <span key="d" className={r.differenceCents < 0 ? "font-semibold text-[var(--error-ink)]" : undefined}>{gap(r)}</span>],
            ] : [["Invoiced", invoiced(r)], ["Our figure", "Not something we can count: the bill's figure is used."]]} />
            <DialogFooter className="items-center sm:justify-between">
              {r.campaignId ? <Link className="text-xs font-semibold text-[var(--accent-ink)] hover:underline" href={campaignHref(r.campaignId)}>Open those leads ›</Link> : <span />}
              <Button type="button" variant="outline" onClick={() => setOpen(null)}>Close</Button>
            </DialogFooter>
          </> : null}
        </DialogContent>
      </Dialog>
    </TableCard>
  );
}

/** Document (2·2): the file, or a drop zone for the vendor's PDF or a photo. */
export function BillDocument({ id, name, readOnly }: { id: string; name: string | null; readOnly: boolean }) {
  const upload = useUpload(id);
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, startBusy] = useTransition();
  const take = (file: File | undefined) => { if (file) startBusy(() => upload(file)); };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!readOnly) take(e.dataTransfer.files?.[0]); };
  const input = <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />;
  if (name) {
    return (
      <TableCard>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <FileText aria-hidden="true" className="size-5 text-muted-foreground" />
          <a className="font-medium text-[var(--accent-ink)] hover:underline" href={`/api/app/accounting/invoices/${id}/document`} target="_blank" rel="noreferrer">{name}</a>
          <span className="flex-1" />
          {readOnly ? null : <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => picker.current?.click()}>Replace the document</Button>}
          {input}
        </div>
      </TableCard>
    );
  }
  return (
    <TableCard>
      <div
        className={`m-4 flex flex-col items-center gap-1 rounded-lg border border-dashed p-8 text-center text-sm ${over ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-border"}`}
        onDragOver={(e) => { e.preventDefault(); if (!readOnly) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <strong className="text-foreground">No document attached</strong>
        {readOnly ? <span className="text-xs text-muted-foreground">{READ_ONLY_REASON}</span> : (
          <span className="text-xs text-muted-foreground">{busy ? "Uploading…" : <>Drop the vendor&apos;s PDF or a photo here · <button type="button" className="font-semibold text-[var(--accent-ink)] hover:underline" onClick={() => picker.current?.click()}>choose a file</button></>}</span>
        )}
        {input}
      </div>
    </TableCard>
  );
}

// ─── The list ───────────────────────────────────────────────────────────────────────────────────

/** The day `n` days before today, as YYYY-MM-DD. */
function daysBefore(n: number): string {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const PERIODS = [{ key: "90", label: "Last 90 days" }, { key: "365", label: "Last 12 months" }, { key: "all", label: "All time" }] as const;
const OPEN: InvoiceStatus[] = ["draft", "received", "disputed", "approved"];
const EMPTY: Record<BillTab, { title: string; hint: string }> = {
  approve: { title: "Nothing to approve", hint: "Every bill that came in is approved, disputed or paid." },
  disputed: { title: "Nothing disputed", hint: "No bill waits on a vendor's answer." },
  approved: { title: "Nothing to pay", hint: "Every approved bill is marked paid." },
  paid: { title: "Nothing paid yet", hint: "A bill lands here once you mark it paid." },
  all: { title: "No bills yet", hint: "Enter each lead vendor's bill as it arrives." },
};

/**
 * Vendor bills (2·A): the strip (each tile opens its tab), then the bills on this tab. The toolbar holds search,
 * the "Billed more than you got" and "No document" chips, the period and Refresh. A row opens the bill.
 */
export function InvoicesBoard({ invoices, readOnly, tab, differs }: { invoices: InvoiceListRow[]; readOnly: boolean; tab: BillTab; differs: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [onlyDiffers, setOnlyDiffers] = useState(differs);
  const [noDocument, setNoDocument] = useState(false);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("365");
  const [page, setPage] = useState(1);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const since = period === "all" ? "" : daysBefore(Number(period));
  const onTab = useMemo(() => invoices.filter((i) => onBillTab(i.status, tab) && (!since || i.invoiceDate >= since || OPEN.includes(i.status))), [invoices, tab, since]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return onTab.filter((i) => (!onlyDiffers || billDiffers(i)) && (!noDocument || !i.hasDocument) && (!needle || i.invoiceNumber.toLowerCase().includes(needle) || i.sourceName.toLowerCase().includes(needle)));
  }, [onTab, q, onlyDiffers, noDocument]);
  const pageSize = useFittingPageSize(480, 52);
  const shown = paginate(visible, page, pageSize);

  const sum = (rows: InvoiceListRow[]) => rows.reduce((s, i) => s + i.totalCents, 0);
  const toApprove = invoices.filter((i) => onBillTab(i.status, "approve"));
  const toPay = invoices.filter((i) => i.status === "approved");
  const firstDue = toPay.map((i) => i.dueDate).filter((d): d is string => Boolean(d)).sort()[0];
  const month = today().slice(0, 7);
  const paidThisMonth = invoices.filter((i) => i.status === "paid" && (i.paidOn ?? "").startsWith(month));
  const over = invoices.filter((i) => billDiffers(i) && i.status !== "paid" && (i.differenceCents ?? 0) < 0);
  const overCents = over.reduce((s, i) => s - (i.differenceCents ?? 0), 0);
  const filtered = q.trim() !== "" || onlyDiffers || noDocument || period !== "365";
  const clear = () => { setQ(""); setOnlyDiffers(false); setNoDocument(false); setPeriod("all"); setPage(1); };

  return (
    <>
      <StatStrip label="Bill totals">
        <StatTile label="To approve" value={money(sum(toApprove))} footnote={`${plural(toApprove.length, "bill")} to check`} href="/app/vendor-bills" />
        <StatTile label="Approved, to pay" value={money(sum(toPay))} footnote={`${plural(toPay.length, "bill")}${firstDue ? ` · due ${billDate(firstDue).replace(/, \d{4}$/, "")}` : ""}`} href="/app/vendor-bills?status=approved" />
        <StatTile label="Paid this month" value={money(sum(paidThisMonth))} footnote={plural(paidThisMonth.length, "bill")} href="/app/vendor-bills?status=paid" />
        <StatTile label="Billed more than you got" value={money(overCents)} footnote={over.length ? <StatusChip tone="danger">Check before paying</StatusChip> : "Every bill matches your count"} href="/app/vendor-bills?status=all&differs=1" />
      </StatStrip>
      <TableCard
        toolbar={
          <DataToolbar actions={<>
            <select aria-label="Period" className={toolbarControl} value={period} onChange={(e) => { setPeriod(e.target.value as typeof period); setPage(1); }}>{PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            <RefreshButton onClick={refresh} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search vendor or bill number" />
            <ToggleChip selected={onlyDiffers} onClick={() => { setOnlyDiffers((v) => !v); setPage(1); }} count={onTab.filter(billDiffers).length} countTone={onTab.some(billDiffers) ? "danger" : undefined}>Billed more than you got</ToggleChip>
            <ToggleChip selected={noDocument} onClick={() => { setNoDocument((v) => !v); setPage(1); }} count={onTab.filter((i) => !i.hasDocument).length}>No document</ToggleChip>
          </DataToolbar>
        }
        footer={visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun={visible.length === 1 ? "bill" : "bills"} onPage={setPage} /> : undefined}
      >
        {invoices.length === 0 ? (
          <EmptyState title="No bills yet" hint="Enter each lead vendor's bill as it arrives. Insurvas checks it against the leads you really got; approving it puts the cost in your P&L." action={!readOnly ? <Button asChild><Link href="/app/vendor-bills/new">Enter a bill</Link></Button> : undefined} />
        ) : onTab.length === 0 && !filtered ? (
          <EmptyState title={EMPTY[tab].title} hint={EMPTY[tab].hint} />
        ) : visible.length === 0 ? (
          <NoMatches noun="bills" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead><tr><th>Vendor</th><th>Bill</th><th>Leads for</th><th className="text-right">Total</th><th>Status</th><th>Next step</th></tr></thead>
            <tbody>
              {shown.rows.map((i) => {
                const href = billHref(i.id, tab);
                const ours = ourCents(i);
                const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
                // Owner 2026-11-11: one line, one colour. The bill date and "no document" are the number's tooltip; our
                // count is the total's; a difference past the tolerance is said in the one chip, not in a red figure.
                const gapCents = i.differenceCents ?? 0;
                const step = readOnly ? null : billNextStep(i);
                return (
                  <tr key={i.id} className={rowClass} onClick={() => router.push(href)}>
                    <td className="whitespace-nowrap"><Link className="font-medium text-foreground hover:underline" href={sourceHref(i.sourceType, i.sourceId)} onClick={stop}>{i.sourceName}</Link></td>
                    <td className="whitespace-nowrap"><Link className="hover:underline" href={href} onClick={stop} title={`Dated ${billDate(i.invoiceDate)}${i.hasDocument ? "" : " · no document attached"}`}>{i.invoiceNumber}</Link></td>
                    <td className="whitespace-nowrap text-muted-foreground">{billPeriod(i.periodStart, i.periodEnd) ?? "—"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums" title={ours == null ? "Nothing we can count" : `Our count ${money(ours)}`}>{money(i.totalCents)}</td>
                    <td className="whitespace-nowrap">{billDiffers(i) && i.status !== "paid"
                      ? <StatusChip tone="danger" title={`${INVOICE_STATUS_LABELS[i.status]} · our count is ${money(ours)}`}>{money(Math.abs(gapCents))} {gapCents < 0 ? "billed over" : "billed under"}</StatusChip>
                      : <InvoiceStatusChip status={i.status} paidOn={i.paidOn} />}</td>
                    <td className="whitespace-nowrap" title={step ?? undefined}>{readOnly || !NEXT_VERB[i.status] ? "Open" : NEXT_VERB[i.status]} ›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
