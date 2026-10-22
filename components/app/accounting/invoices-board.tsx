"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
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

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

type LineDraft = { description: string; campaignId: string; leadType: LeadType; quantity: string; unitPrice: string; amount: string };
const blankLine = (): LineDraft => ({ description: "", campaignId: "", leadType: "live_transfer", quantity: "", unitPrice: "", amount: "" });

function parsedLine(l: LineDraft) {
  const quantity = l.quantity.trim() === "" ? 0 : Number(l.quantity);
  const unit = l.unitPrice.trim() === "" ? 0 : parseDollarsToCents(l.unitPrice);
  const amount = l.amount.trim() === "" ? null : parseDollarsToCents(l.amount);
  return { quantity, unitPriceCents: unit, amountCents: amount };
}

function InvoiceForm({ sources, initial, onClose, onSaved }: { sources: Sources; initial?: InvoiceDetail; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState(() => ({
    source: initial ? `${initial.sourceType}:${initial.sourceId}` : "",
    number: initial?.invoiceNumber ?? "",
    date: initial?.invoiceDate ?? today(),
    periodStart: initial?.periodStart ?? "",
    periodEnd: initial?.periodEnd ?? "",
    due: initial?.dueDate ?? "",
    tax: initial ? dollars(initial.taxCents) : "",
    note: initial?.note ?? "",
    status: (initial?.status === "draft" ? "draft" : "received") as "draft" | "received",
  }));
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines.map((l) => ({
    description: l.description, campaignId: l.campaignId ?? "", leadType: l.leadType, quantity: String(l.quantity), unitPrice: dollars(l.unitPriceCents),
    amount: l.amountCents === l.quantity * l.unitPriceCents ? "" : dollars(l.amountCents),
  })) ?? [blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const setLine = (i: number, k: keyof LineDraft, v: string) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const parsed = lines.map(parsedLine);
  const bad = parsed.some((p, i) => p.unitPriceCents === null || (p.amountCents === null && lines[i].amount.trim() !== "") || !Number.isSafeInteger(p.quantity) || p.quantity < 0);
  const taxCents = f.tax.trim() === "" ? 0 : parseDollarsToCents(f.tax);
  const totals = !bad && taxCents !== null ? invoiceTotals(parsed.map((p) => ({ quantity: p.quantity, unitPriceCents: p.unitPriceCents ?? 0, amountCents: p.amountCents })), taxCents) : null;
  const unattributed = lines.filter((l) => !l.campaignId).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!totals || taxCents === null) { setError("Check the amounts: dollars and cents only."); return; }
    if (taxCents < 0) { setError("Tax can't be negative."); return; }
    if (f.periodStart && f.periodEnd && f.periodEnd < f.periodStart) { setError("“Period to” is before “Period from”."); return; }
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
      onSaved(initial?.id ?? body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };

  const field = "flex flex-col gap-1 text-sm";
  const vendorId = f.source.startsWith("vendor:") ? f.source.slice(7) : null;
  const campaigns = vendorId ? sources.campaigns.filter((c) => c.vendorId === vendorId || !c.vendorId) : sources.campaigns;
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[920px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{initial ? `Invoice ${initial.invoiceNumber}` : "Enter an invoice"}</DialogTitle>
            <DialogDescription>Give each line its campaign. A line without one is counted as unattributed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={`${field} sm:col-span-2`}>From
              <select className={toolbarControl} required value={f.source} onChange={(e) => set("source", e.target.value)}>
                <option value="">Choose…</option>
                {sources.vendors.length ? <optgroup label="Lead vendors">{sources.vendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.name}</option>)}</optgroup> : null}
                {sources.partners.length ? <optgroup label="Partners">{sources.partners.map((p) => <option key={p.id} value={`partner:${p.id}`}>{p.name}</option>)}</optgroup> : null}
              </select>
            </label>
            <label className={field}>Invoice number<input className={toolbarControl} required maxLength={80} value={f.number} onChange={(e) => set("number", e.target.value)} /></label>
            <label className={field}>Invoice date<input type="date" className={toolbarControl} required value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
            <label className={field}>Period from<input type="date" className={toolbarControl} value={f.periodStart} onChange={(e) => set("periodStart", e.target.value)} /></label>
            <label className={field}>Period to<input type="date" className={toolbarControl} value={f.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} /></label>
            <label className={field}>Due<input type="date" className={toolbarControl} value={f.due} onChange={(e) => set("due", e.target.value)} /></label>
            <label className={field}>Tax ($)<input className={toolbarControl} inputMode="decimal" value={f.tax} onChange={(e) => set("tax", e.target.value)} placeholder="0.00" /></label>
          </div>
          <div className="overflow-x-auto">
            <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
              <thead><tr><th>Line</th><th className="w-[190px]">Campaign</th><th className="w-[140px]">Type</th><th className="w-[90px]">Qty</th><th className="w-[110px]">Unit ($)</th><th className="w-[120px]">Amount ($)</th><th className="w-[40px]" /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><input aria-label="Line description" className={`${toolbarControl} w-full`} required maxLength={300} value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} /></td>
                    <td><select aria-label="Campaign" className={`${toolbarControl} w-full`} value={l.campaignId} onChange={(e) => setLine(i, "campaignId", e.target.value)}><option value="">Unattributed</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                    <td><select aria-label="Lead type" className={`${toolbarControl} w-full`} value={l.leadType} onChange={(e) => setLine(i, "leadType", e.target.value)}>{LEAD_TYPES.map((t) => <option key={t} value={t}>{LEAD_TYPE_LABELS[t]}</option>)}</select></td>
                    <td><input aria-label="Quantity" className={`${toolbarControl} w-full`} inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value.replace(/[^\d]/g, ""))} /></td>
                    <td><input aria-label="Unit price" className={`${toolbarControl} w-full`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} /></td>
                    <td><input aria-label="Amount" className={`${toolbarControl} w-full`} inputMode="decimal" value={l.amount} placeholder={parsed[i].unitPriceCents != null ? dollars(lineAmount({ quantity: parsed[i].quantity, unitPriceCents: parsed[i].unitPriceCents ?? 0, amountCents: null })) : ""} onChange={(e) => setLine(i, "amount", e.target.value)} /></td>
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
            <label className={`${field} sm:col-span-3`}>Note<input className={toolbarControl} maxLength={2000} value={f.note} onChange={(e) => set("note", e.target.value)} /></label>
            <label className={field}>Save as<select className={toolbarControl} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="received">Received</option><option value="draft">Draft</option></select></label>
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !totals}>{busy ? "Saving…" : "Save invoice"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FromTemplate({ templates, onClose, onSaved }: { templates: Template[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === templateId);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perUnit = t ? t.lines.filter((l) => l.amountCents == null) : [];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await send("/api/app/accounting/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: templateId, invoice_number: number, invoice_date: date, quantities: perUnit.map((_, i) => Number(qty[i] || 0)) }) });
      notify.done("Invoice entered from the template");
      onSaved(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const field = "flex flex-col gap-1 text-sm";
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>This month&apos;s invoice</DialogTitle>
            <DialogDescription>{t ? `${templateInputs(t).length} fields: the rest comes from the template. The period is the month before the invoice date.` : "Choose a template."}</DialogDescription>
          </DialogHeader>
          <label className={field}>Template<select className={toolbarControl} value={templateId} onChange={(e) => { setTemplateId(e.target.value); setQty([]); }}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.sourceName}</option>)}</select></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>Invoice number<input className={toolbarControl} required maxLength={80} value={number} onChange={(e) => setNumber(e.target.value)} autoFocus /></label>
            <label className={field}>Invoice date<input type="date" className={toolbarControl} required value={date} onChange={(e) => setDate(e.target.value)} /></label>
            {perUnit.map((l, i) => (
              <label key={i} className={field}>{l.description} — quantity<input className={toolbarControl} required inputMode="numeric" value={qty[i] ?? ""} onChange={(e) => setQty((cur) => { const next = [...cur]; next[i] = e.target.value.replace(/[^\d]/g, ""); return next; })} /></label>
            ))}
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !t}>{busy ? "Saving…" : "Enter invoice"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvoicePanel({ id, sources, readOnly, onClose, onChanged, onEdit }: { id: string; sources: Sources; readOnly: boolean; onClose: () => void; onChanged: () => void; onEdit: (inv: InvoiceDetail) => void }) {
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ on: string; method: string; reference: string } | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/app/accounting/invoices/${id}`).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Could not open the invoice");
      else setInv(body.invoice);
    });
    return () => { live = false; };
  }, [id]);
  const act = async (payload: Record<string, unknown>, done: (r: unknown) => string) => {
    setBusy(true);
    setError(null);
    try {
      const body = await send(`/api/app/accounting/invoices/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setInv(body.invoice);
      setPaying(null);
      setVoiding(null);
      notify.done(done(body.result));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    setBusy(true);
    try {
      await send(`/api/app/accounting/invoices/${id}/document`, { method: "POST", body: form });
      const res = await fetch(`/api/app/accounting/invoices/${id}`);
      setInv((await res.json()).invoice);
      notify.done("Document attached");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file didn't upload");
    } finally {
      setBusy(false);
    }
  };
  const saveTemplate = async () => {
    if (!inv) return;
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
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The template didn't save");
    } finally {
      setBusy(false);
    }
  };
  const campaign = (cid: string | null) => (cid ? sources.campaigns.find((c) => c.id === cid)?.name ?? "Campaign" : "Unattributed");
  const editable = inv ? EDITABLE.includes(inv.status) : false;
  const s = inv?.comparison.summary;
  const section = "flex flex-col gap-2 border-t border-border pt-4";
  return (
    <DetailPanel
      mode="overlay"
      title={inv ? `${inv.sourceName} · ${inv.invoiceNumber}` : "Invoice"}
      subtitle={inv ? `Dated ${inv.invoiceDate}${inv.periodStart ? ` · for ${inv.periodStart} to ${inv.periodEnd ?? "…"}` : ""}${inv.dueDate ? ` · due ${inv.dueDate}` : ""}` : undefined}
      status={inv ? <StatusChip tone={TONE[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</StatusChip> : undefined}
      onClose={onClose}
      footer={inv && !readOnly ? (
        <div className="flex flex-wrap gap-2">
          {editable ? <Button disabled={busy} onClick={() => void act({ action: "approve" }, (r) => { const x = r as { entries: number; flagged: boolean }; return `Approved: ${x.entries} cost ${x.entries === 1 ? "entry" : "entries"} booked${x.flagged ? " — flagged for the difference" : ""}`; })}>Approve</Button> : null}
          {inv.status === "approved" ? <Button disabled={busy} onClick={() => setPaying({ on: today(), method: "ach", reference: "" })}>Mark paid</Button> : null}
          {editable ? <Button variant="outline" disabled={busy} onClick={() => onEdit(inv)}>Edit</Button> : null}
          {inv.status === "received" ? <Button variant="outline" disabled={busy} onClick={() => void act({ action: "dispute", note: null }, () => "Marked disputed")}>Dispute</Button> : null}
          {inv.status === "disputed" ? <Button variant="outline" disabled={busy} onClick={() => void act({ action: "undispute" }, () => "Dispute closed")}>Close dispute</Button> : null}
          {inv.status !== "void" ? <Button variant="outline" disabled={busy} onClick={() => setVoiding("")}>Void</Button> : null}
          <Button variant="outline" disabled={busy} onClick={() => void saveTemplate()}>Save as monthly template</Button>
        </div>
      ) : undefined}
    >
      {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
      {!inv ? null : (
        <>
          {paying ? (
            <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">Paid on<input type="date" className={toolbarControl} value={paying.on} onChange={(e) => setPaying({ ...paying, on: e.target.value })} /></label>
              <label className="flex flex-col gap-1 text-sm">Method<select className={toolbarControl} value={paying.method} onChange={(e) => setPaying({ ...paying, method: e.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-sm">Reference on the bank statement<input className={toolbarControl} maxLength={200} value={paying.reference} onChange={(e) => setPaying({ ...paying, reference: e.target.value })} /></label>
              <div className="flex gap-2 sm:col-span-3">
                <Button disabled={busy || !paying.on} onClick={() => void act({ action: "paid", paid_on: paying.on, method: paying.method, reference: paying.reference || null }, () => "Marked paid")}>Record payment</Button>
                <Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
          {voiding !== null ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <label className="flex flex-col gap-1 text-sm">Why is it void?<input className={toolbarControl} maxLength={500} value={voiding} onChange={(e) => setVoiding(e.target.value)} autoFocus /></label>
              <p className="text-xs text-muted-foreground">{inv.entries.length ? "The booked cost is reversed; the original entries stay on record." : "Nothing has been booked yet."}</p>
              <div className="flex gap-2">
                <Button disabled={busy || !voiding.trim()} onClick={() => void act({ action: "void", reason: voiding }, (r) => `Voided${Number(r) ? `: ${r} entries reversed` : ""}`)}>Void invoice</Button>
                <Button variant="outline" onClick={() => setVoiding(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Total</div><div className="font-medium">{money(inv.totalCents)}</div></div>
            <div><div className="text-xs text-muted-foreground">Paid</div><div>{inv.paidOn ? `${inv.paidOn}${inv.paidMethod ? ` · ${PAID_METHOD_LABELS[inv.paidMethod]}` : ""}` : "Not yet"}</div></div>
            <div><div className="text-xs text-muted-foreground">Document</div><div>{inv.hasDocument ? <a className="underline" href={`/api/app/accounting/invoices/${inv.id}/document`} target="_blank" rel="noreferrer">{inv.documentName ?? "Open"}</a> : "None attached"}</div></div>
          </div>
          {!readOnly ? <label className="text-xs text-muted-foreground">{inv.hasDocument ? "Replace the document" : "Attach the invoice"}<input type="file" className="mt-1 block text-xs" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} /></label> : null}
          {inv.voidReason ? <p className="text-sm text-muted-foreground">Void: {inv.voidReason}</p> : null}

          <div className={section}>
            <h3 className="text-sm font-semibold">Lines</h3>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="py-1">Line</th><th>Campaign</th><th className="text-right">Qty</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-1">{l.description}<div className="text-xs text-muted-foreground">{LEAD_TYPE_LABELS[l.leadType]}{l.periodStart ? ` · ${l.periodStart} to ${l.periodEnd ?? "…"}` : ""}</div></td>
                    <td className={l.campaignId ? undefined : "text-[var(--warning-ink)]"}>{campaign(l.campaignId)}</td>
                    <td className="text-right">{l.quantity}</td>
                    <td className="text-right">{money(l.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inv.unattributed.lines ? <p className="text-xs text-[var(--warning-ink)]">{inv.unattributed.lines} line{inv.unattributed.lines === 1 ? "" : "s"} ({money(inv.unattributed.amountCents)}) not attributed to a campaign: counted in your costs, not in any campaign&apos;s cost per policy.</p> : null}
          </div>

          <div className={section}>
            <h3 className="text-sm font-semibold">Invoiced against what we counted{inv.comparison.frozen ? " (as at approval)" : ""}</h3>
            {s?.flagged ? <p role="alert" className="rounded-md border border-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">Our count differs by {money(Math.abs(s.differenceCents))} — more than your {money(s.toleranceCents)} tolerance. Check before paying; approving is still allowed.</p> : null}
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="py-1">Line</th><th className="text-right">Invoiced</th><th className="text-right">We recorded</th><th className="text-right">Rejected at the gate</th><th className="text-right">Credits</th><th className="text-right">Our figure</th><th className="text-right">Difference</th></tr></thead>
              <tbody>
                {inv.comparison.rows.map((r) => {
                  const line = inv.lines.find((l) => l.id === r.lineId);
                  return (
                    <tr key={r.lineId} className="border-t border-border">
                      <td className="py-1">{line?.description ?? LEAD_TYPE_LABELS[r.leadType]}<div className="text-xs text-muted-foreground">{r.periodFrom} to {r.periodTo}</div></td>
                      <td className="text-right">{r.invoicedQuantity}<div className="text-xs text-muted-foreground">{money(r.invoicedCents)}</div></td>
                      {r.countable ? (
                        <>
                          <td className="text-right">{r.recorded}</td>
                          <td className="text-right">{r.rejected ? `−${r.rejected}` : "0"}</td>
                          <td className="text-right">{r.creditedCount ? `−${r.creditedCount}` : "0"}<div className="text-xs text-muted-foreground">{r.creditedCents ? `−${money(r.creditedCents)}` : ""}</div></td>
                          <td className="text-right">{r.ourCount}<div className="text-xs text-muted-foreground">{money(r.ourCents)}</div></td>
                          <td className={`text-right ${r.differenceCents ? "font-medium" : ""}`}>{r.differenceCents ? money(r.differenceCents) : "—"}</td>
                        </>
                      ) : <td colSpan={5} className="text-right text-xs text-muted-foreground">Not something we can count</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {inv.entries.length ? (
            <div className={section}>
              <h3 className="text-sm font-semibold">In the cost ledger</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {inv.entries.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3"><span>{e.description}<span className="text-xs text-muted-foreground"> · {e.incurredOn}{e.paidOn ? ` · paid ${e.paidOn}` : ""}</span></span><span className={e.reverses ? "text-muted-foreground" : undefined}>{money(e.amountCents)}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </DetailPanel>
  );
}

export function InvoicesBoard({ invoices, sources, templates, readOnly, openId }: { invoices: InvoiceListRow[]; sources: Sources; templates: Template[]; readOnly: boolean; openId: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"open" | "all" | InvoiceStatus>("open");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<InvoiceDetail | "new" | null>(null);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [open, setOpen] = useState<string | null>(openId);
  const [version, setVersion] = useState(0);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return invoices.filter((i) => (view === "all" ? true : view === "open" ? ["draft", "received", "disputed", "approved"].includes(i.status) : i.status === view)
      && (!needle || i.invoiceNumber.toLowerCase().includes(needle) || i.sourceName.toLowerCase().includes(needle)));
  }, [invoices, q, view]);
  const shown = paginate(visible, page, 15);
  const toApprove = invoices.filter((i) => EDITABLE.includes(i.status));
  const flagged = invoices.filter((i) => i.flagged && i.status !== "void").length;
  const unpaid = invoices.filter((i) => i.status === "approved");
  const month = today().slice(0, 7);
  const paidThisMonth = invoices.filter((i) => i.status === "paid" && (i.paidOn ?? "").startsWith(month));

  return (
    <>
      <StatStrip label="Invoice totals">
        <StatTile label="To approve" value={String(toApprove.length)} footnote={money(toApprove.reduce((s, i) => s + i.totalCents, 0))} />
        <StatTile label="Approved, unpaid" value={money(unpaid.reduce((s, i) => s + i.totalCents, 0))} footnote={`${unpaid.length} invoice${unpaid.length === 1 ? "" : "s"} owed`} />
        <StatTile label="Paid this month" value={money(paidThisMonth.reduce((s, i) => s + i.totalCents, 0))} footnote={`${paidThisMonth.length} invoice${paidThisMonth.length === 1 ? "" : "s"}`} />
        <StatTile label="Differs from our count" value={String(flagged)} valueTone={flagged ? "warning" : undefined} footnote="beyond tolerance" />
      </StatStrip>
      <TableCard
        toolbar={
          <DataToolbar actions={<>{!readOnly && templates.length ? <Button variant="outline" onClick={() => setFromTemplate(true)}>From a template</Button> : null}{!readOnly ? <Button onClick={() => setCreating("new")}>Enter an invoice</Button> : null}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search number or source" />
            <select aria-label="Which invoices" className={toolbarControl} value={view} onChange={(e) => { setView(e.target.value as typeof view); setPage(1); }}>
              <option value="open">Not yet paid</option>
              <option value="all">All</option>
              {(["received", "disputed", "approved", "paid", "void", "draft"] as InvoiceStatus[]).map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={visible.length > 15 ? <Pager page={shown.current} pageSize={15} total={visible.length} noun="invoices" onPage={setPage} /> : undefined}
      >
        {invoices.length === 0 ? (
          <EmptyState title="No invoices yet" hint="Enter each lead invoice as it arrives: approving it puts the cost in your P&L for the month it belongs to." action={!readOnly ? <Button onClick={() => setCreating("new")}>Enter an invoice</Button> : undefined} />
        ) : visible.length === 0 ? (
          <NoMatches noun="invoices" onClear={() => { setQ(""); setView("all"); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead><tr><th>Invoice</th><th className="w-[110px]">Dated</th><th className="w-[190px]">Period</th><th className="w-[130px] text-right">Total</th><th className="w-[200px]">Status</th><th className="w-[90px] text-right" /></tr></thead>
            <tbody>
              {shown.rows.map((i) => (
                <tr key={i.id}>
                  <td><div className="font-medium">{i.sourceName}</div><div className="text-xs text-muted-foreground">{i.invoiceNumber}{i.hasDocument ? "" : " · no document"}</div></td>
                  <td>{i.invoiceDate}</td>
                  <td>{i.periodStart ? `${i.periodStart} to ${i.periodEnd ?? "…"}` : "—"}</td>
                  <td className="text-right">{money(i.totalCents)}</td>
                  <td><div className="flex flex-wrap gap-1"><StatusChip tone={TONE[i.status]}>{INVOICE_STATUS_LABELS[i.status]}{i.status === "paid" && i.paidOn ? ` ${i.paidOn}` : ""}</StatusChip>{i.flagged && i.status !== "void" ? <StatusChip tone="warning">Differs</StatusChip> : null}</div></td>
                  <td className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(i.id)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {creating ? <InvoiceForm key={creating === "new" ? "new" : creating.id} sources={sources} initial={creating === "new" ? undefined : creating} onClose={() => setCreating(null)} onSaved={(id) => { setCreating(null); setVersion((v) => v + 1); setOpen(id); refresh(); }} /> : null}
      {fromTemplate ? <FromTemplate templates={templates} onClose={() => setFromTemplate(false)} onSaved={(id) => { setFromTemplate(false); setOpen(id); refresh(); }} /> : null}
      {open ? <InvoicePanel key={`${open}-${version}`} id={open} sources={sources} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={refresh} onEdit={(inv) => { setOpen(null); setCreating(inv); }} /> : null}
    </>
  );
}
