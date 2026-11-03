"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog, confirmAction } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Field, control, inputControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Segmented } from "@/components/ui/view-tabs";
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
  type InvoiceStatus,
  type InvoiceTemplate,
  type LeadType,
} from "@/lib/accounting/invoicesCore";
import type { InvoiceDetail, InvoiceListRow } from "@/lib/accounting/invoiceStore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.2 · what the agency paid for leads, one invoice at a time. Each line carries its campaign;
 * before approving, the invoice is set beside what we counted. Approving books the cost; marking
 * paid records when the money moved; voiding reverses — nothing is deleted.
 *
 * Foundation pass (2026-11-03): the list links each invoice to its own page (/app/vendor-bills/[id]: Lines ·
 * Against our count · In the ledger), entering or editing one is a page (/app/vendor-bills/new), and the
 * steps that need a date or a reason are confirm pop-ups. No side panel, no form pop-up.
 */
type Named = { id: string; name: string };
type Sources = { vendors: Named[]; partners: Named[]; campaigns: (Named & { vendorId: string | null })[] };
type Template = InvoiceTemplate & { sourceName: string; lastUsedAt: string | null };

const TONE: Record<InvoiceStatus, StatusTone> = { draft: "neutral", received: "warning", disputed: "danger", approved: "info", paid: "good", void: "neutral" };
const money = (cents: number | null | undefined) => (cents == null ? "—" : formatCentsAsCurrency(cents));
const today = () => new Date().toISOString().slice(0, 10);
/** Cents as a dollar string for an input, by string handling alone (no float). */
const dollars = (cents: number) => {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
const OPEN: InvoiceStatus[] = ["draft", "received", "disputed", "approved"];

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

export function InvoiceStatusChip({ status, paidOn }: { status: InvoiceStatus; paidOn?: string | null }) {
  return <StatusChip tone={TONE[status]}>{INVOICE_STATUS_LABELS[status]}{status === "paid" && paidOn ? ` ${paidOn}` : ""}</StatusChip>;
}

type LineDraft = { description: string; campaignId: string; leadType: LeadType; quantity: string; unitPrice: string; amount: string };
const blankLine = (): LineDraft => ({ description: "", campaignId: "", leadType: "live_transfer", quantity: "", unitPrice: "", amount: "" });

function parsedLine(l: LineDraft) {
  const quantity = l.quantity.trim() === "" ? 0 : Number(l.quantity);
  const unit = l.unitPrice.trim() === "" ? 0 : parseDollarsToCents(l.unitPrice);
  const amount = l.amount.trim() === "" ? null : parseDollarsToCents(l.amount);
  return { quantity, unitPriceCents: unit, amountCents: amount };
}

/** /app/vendor-bills/new: enter an invoice (blank or from a monthly template), or edit one (`initial`). */
export function InvoiceEntry({ sources, templates, initial, templateId }: { sources: Sources; templates: Template[]; initial?: InvoiceDetail; templateId?: string }) {
  const [mode, setMode] = useState<"blank" | "template">(!initial && templateId ? "template" : "blank");
  return (
    <div className="flex flex-col gap-4">
      {!initial && templates.length ? <Segmented label="How" value={mode} onChange={setMode} options={[{ key: "blank", label: "Blank" }, { key: "template", label: "From a template" }]} /> : null}
      {mode === "template" && !initial ? <FromTemplate templates={templates} initialId={templateId} /> : <InvoiceForm sources={sources} initial={initial} />}
    </div>
  );
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
    status: (initial?.status === "draft" ? "draft" : "received") as "draft" | "received",
  });
  const startLines = (): LineDraft[] => initial?.lines.map((l) => ({
    description: l.description, campaignId: l.campaignId ?? "", leadType: l.leadType, quantity: String(l.quantity), unitPrice: dollars(l.unitPriceCents),
    amount: l.amountCents === l.quantity * l.unitPriceCents ? "" : dollars(l.amountCents),
  })) ?? [blankLine()];
  const [f, setF] = useState(start);
  const [lines, setLines] = useState<LineDraft[]>(startLines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  const set = (k: keyof ReturnType<typeof start>, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const setLine = (i: number, k: keyof LineDraft, v: string) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const dirty = JSON.stringify(f) !== JSON.stringify(start()) || JSON.stringify(lines) !== JSON.stringify(startLines());
  const discard = () => { setF(start()); setLines(startLines()); };

  const parsed = lines.map(parsedLine);
  const bad = parsed.some((p, i) => p.unitPriceCents === null || (p.amountCents === null && lines[i].amount.trim() !== "") || !Number.isSafeInteger(p.quantity) || p.quantity < 0);
  const taxCents = f.tax.trim() === "" ? 0 : parseDollarsToCents(f.tax);
  const totals = !bad && taxCents !== null ? invoiceTotals(parsed.map((p) => ({ quantity: p.quantity, unitPriceCents: p.unitPriceCents ?? 0, amountCents: p.amountCents })), taxCents) : null;
  const unattributed = lines.filter((l) => !l.campaignId).length;

  const save = async (): Promise<boolean> => {
    if (!totals || taxCents === null) { setError("Check the amounts: dollars and cents only."); return false; }
    if (taxCents < 0) { setError("Tax can't be negative."); return false; }
    if (f.periodStart && f.periodEnd && f.periodEnd < f.periodStart) { setError("“Period to” is before “Period from”."); return false; }
    if (!f.source || !f.number.trim()) { setError("Say who sent it and its invoice number."); return false; }
    const [kind, id] = f.source.split(":");
    setBusy(true);
    setError(null);
    try {
      const payload = {
        vendor_id: kind === "vendor" ? id : null, partner_id: kind === "partner" ? id : null, invoice_number: f.number, invoice_date: f.date,
        period_start: f.periodStart || null, period_end: f.periodEnd || null, due_date: f.due || null, tax_cents: taxCents, note: f.note || null, status: f.status,
        lines: lines.map((l, i) => ({ description: l.description, campaign_id: l.campaignId || null, lead_type: l.leadType, quantity: parsed[i].quantity, unit_price_cents: parsed[i].unitPriceCents ?? 0, amount_cents: parsed[i].amountCents })),
      };
      const body = initial
        ? await send(`/api/app/accounting/invoices/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await send("/api/app/accounting/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      notify.done(initial ? "Invoice saved" : "Invoice entered");
      router.push(`/app/vendor-bills/${initial?.id ?? body.id}`);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };

  const vendorId = f.source.startsWith("vendor:") ? f.source.slice(7) : null;
  const campaigns = vendorId ? sources.campaigns.filter((c) => c.vendorId === vendorId || !c.vendorId) : sources.campaigns;
  const cell = `${inputControl} w-full`;
  return (
    <form ref={scope} onSubmit={submit} className={`${cardSurface} flex flex-col gap-4 p-5`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="From" htmlFor="inv-source" required className="sm:col-span-2">
          <select id="inv-source" className={control} required value={f.source} onChange={(e) => set("source", e.target.value)}>
            <option value="">Choose…</option>
            {sources.vendors.length ? <optgroup label="Lead vendors">{sources.vendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.name}</option>)}</optgroup> : null}
            {sources.partners.length ? <optgroup label="Partners">{sources.partners.map((p) => <option key={p.id} value={`partner:${p.id}`}>{p.name}</option>)}</optgroup> : null}
          </select>
        </Field>
        <Field label="Invoice number" htmlFor="inv-number" required><input id="inv-number" className={control} required maxLength={80} value={f.number} onChange={(e) => set("number", e.target.value)} /></Field>
        <Field label="Invoice date" htmlFor="inv-date" required><input id="inv-date" type="date" className={control} required value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Period from" htmlFor="inv-from"><input id="inv-from" type="date" className={control} value={f.periodStart} onChange={(e) => set("periodStart", e.target.value)} /></Field>
        <Field label="Period to" htmlFor="inv-to"><input id="inv-to" type="date" className={control} value={f.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} /></Field>
        <Field label="Due" htmlFor="inv-due"><input id="inv-due" type="date" className={control} value={f.due} onChange={(e) => set("due", e.target.value)} /></Field>
        <Field label="Tax ($)" htmlFor="inv-tax"><input id="inv-tax" className={control} inputMode="decimal" value={f.tax} onChange={(e) => set("tax", e.target.value)} placeholder="0.00" /></Field>
      </div>
      <div className="overflow-x-auto">
        <table className="portal-lead-table w-full min-w-[820px] text-left text-sm" data-even="off">
          {/* data-even off: the inputs size the columns; an even spread would squeeze the description. */}
          <thead><tr><th>Line</th><th className="w-[190px]">Campaign</th><th className="w-[170px]">Type</th><th className="w-[90px]">Qty</th><th className="w-[110px]">Unit ($)</th><th className="w-[120px]">Amount ($)</th><th className="w-[40px]"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><input aria-label="Line description" className={cell} required maxLength={300} value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} /></td>
                <td><select aria-label="Campaign" className={cell} value={l.campaignId} onChange={(e) => setLine(i, "campaignId", e.target.value)}><option value="">Unattributed</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                <td><select aria-label="Lead type" className={cell} value={l.leadType} onChange={(e) => setLine(i, "leadType", e.target.value)}>{LEAD_TYPES.map((t) => <option key={t} value={t}>{LEAD_TYPE_LABELS[t]}</option>)}</select></td>
                <td><input aria-label="Quantity" className={cell} inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value.replace(/[^\d]/g, ""))} /></td>
                <td><input aria-label="Unit price" className={cell} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} /></td>
                <td><input aria-label="Amount" className={cell} inputMode="decimal" value={l.amount} placeholder={parsed[i].unitPriceCents != null ? dollars(lineAmount({ quantity: parsed[i].quantity, unitPriceCents: parsed[i].unitPriceCents ?? 0, amountCents: null })) : ""} onChange={(e) => setLine(i, "amount", e.target.value)} /></td>
                <td>{lines.length > 1 ? <Button type="button" size="sm" variant="ghost" aria-label="Remove line" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>×</Button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Button type="button" variant="outline" onClick={() => setLines((cur) => [...cur, blankLine()])}>Add a line</Button>
        <span className="text-muted-foreground">
          {unattributed ? `${unattributed} unattributed line${unattributed === 1 ? "" : "s"} · ` : ""}
          {totals ? <>Subtotal {money(totals.subtotalCents)} · Total <strong className="text-foreground">{money(totals.totalCents)}</strong></> : "Check the amounts"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Note" htmlFor="inv-note" className="sm:col-span-3"><input id="inv-note" className={control} maxLength={2000} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
        <Field label="Save as" htmlFor="inv-status"><select id="inv-status" className={control} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="received">Received</option><option value="draft">Draft</option></select></Field>
      </div>
      {error ? <Callout tone="error" title={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" asChild><Link href={initial ? `/app/vendor-bills/${initial.id}` : "/app/vendor-bills"}>Discard</Link></Button>
        <Button type="submit" disabled={busy || !totals}>{busy ? "Saving…" : "Save invoice"}</Button>
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={discard} what="this invoice" />
    </form>
  );
}

function FromTemplate({ templates, initialId }: { templates: Template[]; initialId?: string }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates.find((x) => x.id === initialId)?.id ?? templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === templateId);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  const perUnit = t ? t.lines.filter((l) => l.amountCents == null) : [];
  const dirty = Boolean(number || qty.some(Boolean));
  const save = async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const body = await send("/api/app/accounting/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: templateId, invoice_number: number, invoice_date: date, quantities: perUnit.map((_, i) => Number(qty[i] || 0)) }) });
      notify.done("Invoice entered from the template");
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
    if (!t || !(await confirmAction({ title: `Delete the template “${t.name}”?`, description: "Invoices already entered from it stay as they are.", confirmLabel: "Delete template", cancelLabel: "Keep template" }))) return;
    setBusy(true);
    try {
      await send(`/api/app/accounting/invoice-templates?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
      notify.done("Template deleted");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The template wasn't deleted");
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };
  return (
    <form ref={scope} onSubmit={submit} className={`${cardSurface} flex flex-col gap-4 p-5`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Template" htmlFor="tpl-pick" hint={t ? `${templateInputs(t).length} fields: the rest comes from the template. The period is the month before the invoice date.` : undefined} className="sm:col-span-2 xl:col-span-1">
          <select id="tpl-pick" className={control} value={templateId} onChange={(e) => { setTemplateId(e.target.value); setQty([]); }}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.sourceName}</option>)}</select>
        </Field>
        <Field label="Invoice number" htmlFor="tpl-number" required><input id="tpl-number" className={control} required maxLength={80} value={number} onChange={(e) => setNumber(e.target.value)} autoFocus /></Field>
        <Field label="Invoice date" htmlFor="tpl-date" required><input id="tpl-date" type="date" className={control} required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {perUnit.map((l, i) => (
          <Field key={i} label={`${l.description}: quantity`} htmlFor={`tpl-qty-${i}`} required><input id={`tpl-qty-${i}`} className={control} required inputMode="numeric" value={qty[i] ?? ""} onChange={(e) => setQty((cur) => { const next = [...cur]; next[i] = e.target.value.replace(/[^\d]/g, ""); return next; })} /></Field>
        ))}
      </div>
      {error ? <Callout tone="error" title={error} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" disabled={busy || !t} onClick={() => void remove()}>Delete this template</Button>
        <span className="flex gap-2">
          <Button type="button" variant="outline" asChild><Link href="/app/vendor-bills">Discard</Link></Button>
          <Button type="submit" disabled={busy || !t}>{busy ? "Saving…" : "Enter invoice"}</Button>
        </span>
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => { setNumber(""); setQty([]); }} what="this invoice" />
    </form>
  );
}

/** The list's header: Enter an invoice, and From a template in More when the agency has one. */
export function InvoiceListActions({ templates }: { templates: number }) {
  return (
    <>
      <MoreMenu items={[templates > 0 && { label: "From a monthly template", href: "/app/vendor-bills/new?template=first" }]} />
      <Button asChild><Link href="/app/vendor-bills/new">Enter an invoice</Link></Button>
    </>
  );
}

type Head = Pick<InvoiceDetail, "id" | "status" | "sourceName" | "sourceType" | "sourceId" | "invoiceNumber" | "taxCents" | "hasDocument" | "lines"> & { booked: boolean };
type Asking = { kind: "paid"; on: string; method: string; reference: string } | { kind: "dispute"; note: string } | { kind: "void"; reason: string };

/**
 * An invoice page's header: at most two buttons by status — Approve or Mark paid, and Edit while it can
 * still change — then More (dispute, void, save as a template, the document). Approving books at once:
 * the comparison is on the page before it (flags, never blocks).
 */
export function InvoiceActions({ inv, readOnly }: { inv: Head; readOnly: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const editable = EDITABLE.includes(inv.status);
  const act = async (payload: Record<string, unknown>, done: (r: unknown) => string) => {
    setBusy(true);
    try {
      const body = await send(`/api/app/accounting/invoices/${inv.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      notify.done(done(body.result));
      setAsking(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    setBusy(true);
    try {
      await send(`/api/app/accounting/invoices/${inv.id}/document`, { method: "POST", body: form });
      notify.done("Document attached");
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "The file didn't upload");
    } finally {
      setBusy(false);
    }
  };
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
  if (readOnly) return <MoreMenu items={[documentItem]} />;
  return (
    <>
      <MoreMenu items={[
        inv.status === "received" && { label: "Dispute", onSelect: () => setAsking({ kind: "dispute", note: "" }) },
        inv.status === "disputed" && { label: "Close the dispute", onSelect: () => void act({ action: "undispute" }, () => "Dispute closed") },
        inv.status !== "void" && { label: "Void", onSelect: () => setAsking({ kind: "void", reason: "" }) },
        { label: "Save as a monthly template", onSelect: () => void saveTemplate(), disabled: busy },
        { label: inv.hasDocument ? "Replace the document" : "Attach the invoice", onSelect: () => picker.current?.click() },
        documentItem,
      ]} />
      {editable ? <Button variant="outline" asChild><Link href={`/app/vendor-bills/new?edit=${inv.id}`}>Edit</Link></Button> : null}
      {editable ? <Button disabled={busy} onClick={() => void act({ action: "approve" }, (r) => { const x = r as { entries: number; flagged: boolean }; return `Approved: ${x.entries} cost ${x.entries === 1 ? "entry" : "entries"} booked${x.flagged ? " — flagged for the difference" : ""}`; })}>Approve</Button> : null}
      {inv.status === "approved" ? <Button disabled={busy} onClick={() => setAsking({ kind: "paid", on: today(), method: "ach", reference: "" })}>Mark paid</Button> : null}
      <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
      {asking ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => { if (!next) setAsking(null); }}
          busy={busy}
          destructive={asking.kind === "void"}
          title={asking.kind === "paid" ? `Mark ${inv.invoiceNumber} paid?` : asking.kind === "dispute" ? `Dispute ${inv.invoiceNumber}?` : `Void ${inv.invoiceNumber}?`}
          description={asking.kind === "paid" ? "Records when the money moved. Nothing is paid from here." : asking.kind === "dispute" ? "It stays unapproved until the dispute is closed." : inv.booked ? "The booked cost is reversed; the original entries stay on record." : "Nothing has been booked yet."}
          confirmLabel={asking.kind === "paid" ? "Record payment" : asking.kind === "dispute" ? "Dispute invoice" : "Void invoice"}
          cancelLabel="Keep it"
          confirmDisabled={asking.kind === "void" ? !asking.reason.trim() : asking.kind === "paid" ? !asking.on : false}
          onConfirm={() => void (asking.kind === "paid" ? act({ action: "paid", paid_on: asking.on, method: asking.method, reference: asking.reference || null }, () => "Marked paid")
            : asking.kind === "dispute" ? act({ action: "dispute", note: asking.note.trim() || null }, () => "Marked disputed")
            : act({ action: "void", reason: asking.reason }, (r) => `Voided${Number(r) ? `: ${r} entries reversed` : ""}`))}
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
            <Field label="Why is it void?" htmlFor="inv-void"><input id="inv-void" className={control} autoFocus maxLength={500} value={asking.reason} onChange={(e) => setAsking({ ...asking, reason: e.target.value })} /></Field>
          )}
        />
      ) : null}
    </>
  );
}

type Filter = "open" | "all" | "approve" | InvoiceStatus | "flagged";

export function InvoicesBoard({ invoices, readOnly, status }: { invoices: InvoiceListRow[]; readOnly: boolean; status?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const initial: Filter = status === "all" || status === "flagged" || status === "approve" || (status && status in INVOICE_STATUS_LABELS) ? (status as Filter) : "open";
  const [view, setView] = useState<Filter>(initial);
  const [page, setPage] = useState(1);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return invoices.filter((i) => (view === "all" ? true : view === "open" ? OPEN.includes(i.status) : view === "flagged" ? i.flagged && i.status !== "void" : view === "approve" ? EDITABLE.includes(i.status) : i.status === view)
      && (!needle || i.invoiceNumber.toLowerCase().includes(needle) || i.sourceName.toLowerCase().includes(needle)));
  }, [invoices, q, view]);
  const pageSize = useFittingPageSize(480, 45);
  const shown = paginate(visible, page, pageSize);
  const toApprove = invoices.filter((i) => EDITABLE.includes(i.status));
  const flagged = invoices.filter((i) => i.flagged && i.status !== "void").length;
  const unpaid = invoices.filter((i) => i.status === "approved");
  const month = today().slice(0, 7);
  const paidThisMonth = invoices.filter((i) => i.status === "paid" && (i.paidOn ?? "").startsWith(month));
  const pick = (next: Filter) => { setView(next); setPage(1); };

  return (
    <>
      <StatStrip label="Invoice totals">
        <StatTile label="To approve" value={String(toApprove.length)} footnote={money(toApprove.reduce((s, i) => s + i.totalCents, 0))} href="/app/vendor-bills?status=approve" />
        <StatTile label="Approved, unpaid" value={money(unpaid.reduce((s, i) => s + i.totalCents, 0))} footnote={`${unpaid.length} invoice${unpaid.length === 1 ? "" : "s"} owed`} href="/app/vendor-bills?status=approved" />
        <StatTile label="Paid this month" value={money(paidThisMonth.reduce((s, i) => s + i.totalCents, 0))} footnote={`${paidThisMonth.length} invoice${paidThisMonth.length === 1 ? "" : "s"}`} href="/app/vendor-bills?status=paid" />
        <StatTile label="Differs from our count" value={String(flagged)} valueTone={flagged ? "warning" : undefined} footnote="beyond tolerance" href="/app/vendor-bills?status=flagged" />
      </StatStrip>
      <TableCard
        key={initial}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search number or source" />
            <select aria-label="Which invoices" className={toolbarControl} value={view} onChange={(e) => pick(e.target.value as Filter)}>
              <option value="open">Not yet paid</option>
              <option value="all">All</option>
              <option value="approve">To approve</option>
              <option value="flagged">Differs from our count</option>
              {(["received", "disputed", "approved", "paid", "void", "draft"] as InvoiceStatus[]).map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={visible.length > pageSize ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="invoices" onPage={setPage} /> : undefined}
      >
        {invoices.length === 0 ? (
          <EmptyState title="No invoices yet" hint="Enter each lead invoice as it arrives: approving it puts the cost in your P&L for the month it belongs to." action={!readOnly ? <Button asChild><Link href="/app/vendor-bills/new">Enter an invoice</Link></Button> : undefined} />
        ) : visible.length === 0 ? (
          <NoMatches noun="invoices" onClear={() => { setQ(""); pick("all"); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead><tr><th>Invoice</th><th className="w-[110px]">Dated</th><th className="w-[190px]">Period</th><th className="w-[130px] text-right">Total</th><th className="w-[200px]">Status</th><th className="w-[90px] text-right"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {shown.rows.map((i) => (
                <tr key={i.id}>
                  <td><Link className="font-medium hover:underline" href={`/app/vendor-bills/${i.id}`}>{i.sourceName}</Link><div className="text-xs text-muted-foreground">{i.invoiceNumber}{i.hasDocument ? "" : " · no document"}</div></td>
                  <td className="tabular-nums">{i.invoiceDate}</td>
                  <td>{i.periodStart ? `${i.periodStart} to ${i.periodEnd ?? "…"}` : "—"}</td>
                  <td className="text-right tabular-nums">{money(i.totalCents)}</td>
                  <td><div className="flex flex-wrap gap-1"><InvoiceStatusChip status={i.status} paidOn={i.paidOn} />{i.flagged && i.status !== "void" ? <StatusChip tone="warning">Differs</StatusChip> : null}</div></td>
                  <td className="text-right"><Button size="sm" variant="outline" asChild><Link href={`/app/vendor-bills/${i.id}`}>Open</Link></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
