"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { ViewTabs } from "@/components/ui/view-tabs";
import {
  ACQUISITION_CONSEQUENCE,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  RECURRENCE_LABELS,
  RECURRENCES,
  type ExpenseCategory,
  type Recurrence,
} from "@/lib/accounting/expensesCore";
import type { ExpenseRow } from "@/lib/accounting/expenseStore";
import { PAID_METHOD_LABELS, PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";
import { fieldLabel } from "@/components/ui/field";

/**
 * LA-7.3 · everything spent that is not a lead. Recurring ones arrive each month unconfirmed and
 * book nothing until confirmed here — a cancelled subscription must not keep costing money in the
 * P&L because nobody said so. Each expense is acquisition or overhead, and the choice is shown.
 */
type View = "confirm" | "booked" | "recurring";
const money = (cents: number) => formatCentsAsCurrency(cents);
const today = () => new Date().toISOString().slice(0, 10);

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

function NewExpense({ defaults, onClose, onSaved }: { defaults: Record<ExpenseCategory, boolean>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ category: "software" as ExpenseCategory, vendor: "", description: "", amount: "", on: today(), recurrence: "one_off" as Recurrence, end: "", acq: "default", paidOn: "", method: "card" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const fallback = defaults[f.category];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseDollarsToCents(f.amount);
    if (cents === null || cents <= 0) { setError("Enter the amount in dollars and cents."); return; }
    setBusy(true);
    setError(null);
    try {
      const body = await send("/api/app/accounting/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: f.category, vendor_name: f.vendor, description: f.description || null, amount_cents: cents, incurred_on: f.on, recurrence: f.recurrence,
          recurrence_end_on: f.recurrence !== "one_off" && f.end ? f.end : null, is_acquisition_cost: f.acq === "default" ? null : f.acq === "yes",
          ...(f.recurrence === "one_off" && f.paidOn ? { paid_on: f.paidOn, paid_method: f.method } : {}),
        }),
      });
      notify.done(f.recurrence === "one_off" ? "Expense booked" : `Recurring expense set${body.generated ? `: ${body.generated} month${body.generated === 1 ? "" : "s"} to confirm` : ""}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  // The shared stacked label (foundation v3: 13/500 over the control).
  const field = fieldLabel;
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[640px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add an expense</DialogTitle>
            <DialogDescription>A one-off is booked as you save it. A recurring one arrives each period for you to confirm.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>Category<select className={toolbarControl} value={f.category} onChange={(e) => set("category", e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}</select></label>
            <label className={field}>Paid to<input className={toolbarControl} required maxLength={120} value={f.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="e.g. the dialer company" /></label>
            <label className={field}>Amount ($)<input className={toolbarControl} required inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></label>
            <label className={field}>{f.recurrence === "one_off" ? "For the period of" : "First period"}<input type="date" className={toolbarControl} required value={f.on} onChange={(e) => set("on", e.target.value)} /></label>
            <label className={field}>Repeats<select className={toolbarControl} value={f.recurrence} onChange={(e) => set("recurrence", e.target.value)}>{RECURRENCES.map((r) => <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}</select></label>
            {f.recurrence !== "one_off" ? <label className={field}>Ends (optional)<input type="date" className={toolbarControl} value={f.end} onChange={(e) => set("end", e.target.value)} /></label> : <label className={field}>Paid on (optional)<input type="date" className={toolbarControl} value={f.paidOn} onChange={(e) => set("paidOn", e.target.value)} /></label>}
            <label className={`${field} sm:col-span-2`}>Counts as
              <select className={toolbarControl} value={f.acq} onChange={(e) => set("acq", e.target.value)}>
                <option value="default">{fallback ? "Acquisition" : "Overhead"} — the default for {EXPENSE_CATEGORY_LABELS[f.category].toLowerCase()}</option>
                <option value={fallback ? "no" : "yes"}>{fallback ? "Overhead" : "Acquisition"} — your choice for this one</option>
              </select>
              <span className="text-xs text-muted-foreground">{ACQUISITION_CONSEQUENCE}</span>
            </label>
            <label className={`${field} sm:col-span-2`}>Note<input className={toolbarControl} maxLength={500} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : f.recurrence === "one_off" ? "Book expense" : "Set up"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The view an expense is listed under. */
const viewOf = (e: ExpenseRow): View => (e.status === "unconfirmed" ? "confirm" : e.status === "template" ? "recurring" : "booked");

export function ExpensesBoard({ expenses, defaults, readOnly, openId = null }: { expenses: ExpenseRow[]; defaults: Record<ExpenseCategory, boolean>; readOnly: boolean; openId?: string | null }) {
  const router = useRouter();
  const unconfirmed = expenses.filter((e) => e.status === "unconfirmed");
  // ?open={id} (a P&L drill-through) opens the view and page holding that expense, and marks its row.
  const target = openId ? expenses.find((e) => e.id === openId) ?? null : null;
  const [view, setView] = useState<View>(target ? viewOf(target) : unconfirmed.length ? "confirm" : "booked");
  const [q, setQ] = useState("");
  const pageSize = useFittingPageSize(480, 45);
  // Until someone pages, the page follows the target row, so a re-fitted page size still shows it.
  const [picked, setPage] = useState<number | null>(null);
  const targetIndex = useMemo(() => {
    if (!target) return 0;
    const list = target.status === "unconfirmed" ? unconfirmed : target.status === "template" ? expenses.filter((e) => e.status === "template") : expenses.filter((e) => e.status === "confirmed" || e.status === "void");
    return Math.max(list.findIndex((e) => e.id === target.id), 0);
  }, [target, unconfirmed, expenses]);
  const page = picked ?? Math.floor(targetIndex / pageSize) + 1;
  useEffect(() => {
    if (target) document.getElementById(`expense-${target.id}`)?.scrollIntoView({ block: "center" });
  }, [target]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const [paying, setPaying] = useState<{ id: string; on: string; method: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; amount: string; end: string } | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const act = async (id: string, payload: Record<string, unknown>, done: string, method = "POST") => {
    setBusy(id);
    try {
      await send(`/api/app/accounting/expenses/${id}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      notify.done(done);
      setVoiding(null);
      setPaying(null);
      setEditing(null);
      refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(null);
    }
  };
  const confirmAll = async () => {
    setBusy("all");
    let n = 0;
    try {
      for (const e of unconfirmed) {
        await send(`/api/app/accounting/expenses/${e.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm" }) });
        n += 1;
      }
      notify.done(`${n} expense${n === 1 ? "" : "s"} confirmed`);
    } catch (err) {
      notify.fail(err instanceof Error ? `${n} confirmed, then: ${err.message}` : "That didn't save");
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const upload = async (id: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    setBusy(id);
    try {
      await send(`/api/app/accounting/expenses/${id}`, { method: "PATCH", body: form });
      notify.done("Receipt attached");
      refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "The file didn't upload");
    } finally {
      setBusy(null);
    }
  };

  const month = today().slice(0, 7);
  const bookedThisMonth = expenses.filter((e) => e.status === "confirmed" && e.incurredOn.startsWith(month));
  const acq = bookedThisMonth.filter((e) => e.isAcquisitionCost).reduce((s, e) => s + e.amountCents, 0);
  const over = bookedThisMonth.filter((e) => !e.isAcquisitionCost).reduce((s, e) => s + e.amountCents, 0);
  const templates = expenses.filter((e) => e.status === "template");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = view === "confirm" ? unconfirmed : view === "recurring" ? templates : expenses.filter((e) => e.status === "confirmed" || e.status === "void");
    return base.filter((e) => !needle || e.vendorName.toLowerCase().includes(needle) || (e.description ?? "").toLowerCase().includes(needle));
  }, [expenses, unconfirmed, templates, view, q]);
  const shown = paginate(rows, page, pageSize);

  return (
    <>
      <StatStrip label="Expense totals">
        <StatTile label="To confirm" value={String(unconfirmed.length)} valueTone={unconfirmed.length ? "warning" : undefined} footnote={money(unconfirmed.reduce((s, e) => s + e.amountCents, 0))} />
        <StatTile label="Acquisition this month" value={money(acq)} footnote="in cost per policy" />
        <StatTile label="Overhead this month" value={money(over)} footnote="net profit only" />
        <StatTile label="Recurring" value={String(templates.length)} footnote="templates" />
      </StatStrip>
      <ViewTabs
        label="Expense views"
        value={view}
        onChange={(k) => { setView(k); setPage(1); }}
        tabs={[
          { key: "confirm", label: "To confirm", count: unconfirmed.length, tone: "danger" },
          { key: "booked", label: "Booked" },
          { key: "recurring", label: "Recurring", count: templates.length },
        ]}
      />
      <TableCard
        toolbar={
          <DataToolbar actions={<>{view === "confirm" && unconfirmed.length && !readOnly ? <Button variant="outline" disabled={busy !== null} onClick={() => void confirmAll()}>Confirm all {unconfirmed.length}</Button> : null}{!readOnly ? <Button onClick={() => setCreating(true)}>Add an expense</Button> : null}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search who it was paid to" />
          </DataToolbar>
        }
        footer={rows.length ? <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="expenses" onPage={setPage} /> : undefined}
      >
        {expenses.length === 0 ? (
          <EmptyState title="No expenses yet" hint="Add the dialer, the CRM, the lead spend: without them cost per policy is too low." action={!readOnly ? <Button onClick={() => setCreating(true)}>Add an expense</Button> : undefined} />
        ) : rows.length === 0 ? (
          view === "confirm" && !q ? <EmptyState title="Nothing to confirm" hint="This period's recurring expenses are all confirmed." /> : <NoMatches noun="expenses" onClear={() => setQ("")} />
        ) : (
          <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
            <thead><tr><th>Paid to</th><th className="w-[120px]">{view === "recurring" ? "From" : "Period"}</th><th className="w-[120px] text-right">Amount</th><th className="w-[200px]">Counts as</th><th className="w-[160px]">{view === "recurring" ? "Repeats" : "Status"}</th><th className="w-[260px] text-right" /></tr></thead>
            <tbody>
              {shown.rows.map((e) => (
                <tr key={e.id} id={`expense-${e.id}`} aria-current={e.id === target?.id ? "true" : undefined} className={e.id === target?.id ? "bg-[var(--surface-alt)]" : undefined}>
                  <td><div className="font-medium">{e.vendorName}</div><div className="text-xs text-muted-foreground">{EXPENSE_CATEGORY_LABELS[e.category]}{e.description ? ` · ${e.description}` : ""}{e.hasReceipt ? "" : e.status === "confirmed" ? " · no receipt" : ""}</div></td>
                  <td>{e.incurredOn}{e.status === "template" && e.recurrenceEndOn ? <div className="text-xs text-muted-foreground">until {e.recurrenceEndOn}</div> : null}</td>
                  <td className="text-right">{money(e.amountCents)}</td>
                  <td>
                    <select aria-label="Acquisition or overhead" className={toolbarControl} disabled={readOnly || e.status === "void" || busy === e.id} value={e.isAcquisitionCost ? "yes" : "no"}
                      onChange={(ev) => void act(e.id, { action: "classify", is_acquisition_cost: ev.target.value === "yes" }, "Saved")}>
                      <option value="yes">Acquisition</option><option value="no">Overhead</option>
                    </select>
                    {e.acquisitionOverridden ? <div className="text-xs text-muted-foreground">Overrides the category default</div> : null}
                  </td>
                  <td>
                    {e.status === "template" ? RECURRENCE_LABELS[e.recurrence]
                      : e.status === "unconfirmed" ? <StatusChip tone="warning">Not booked</StatusChip>
                      : e.status === "void" ? <StatusChip tone="neutral">Void</StatusChip>
                      : <StatusChip tone={e.paidOn ? "good" : "info"}>{e.paidOn ? `Paid ${e.paidOn}` : "Booked, unpaid"}</StatusChip>}
                  </td>
                  <td className="text-right">
                    {readOnly ? null : voiding?.id === e.id ? (
                      <span className="inline-flex gap-1"><input aria-label="Why" className={`${toolbarControl} w-36`} placeholder="Why?" value={voiding.reason} onChange={(ev) => setVoiding({ id: e.id, reason: ev.target.value })} /><Button size="sm" disabled={!voiding.reason.trim() || busy === e.id} onClick={() => void act(e.id, { action: "void", reason: voiding.reason }, e.status === "confirmed" ? "Voided: the cost is reversed" : "Skipped")}>Void</Button><Button size="sm" variant="ghost" onClick={() => setVoiding(null)}>×</Button></span>
                    ) : paying?.id === e.id ? (
                      <span className="inline-flex gap-1"><input aria-label="Paid on" type="date" className={toolbarControl} value={paying.on} onChange={(ev) => setPaying({ ...paying, on: ev.target.value })} /><select aria-label="Method" className={toolbarControl} value={paying.method} onChange={(ev) => setPaying({ ...paying, method: ev.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select><Button size="sm" disabled={busy === e.id} onClick={() => void act(e.id, { action: "paid", paid_on: paying.on, method: paying.method, reference: null }, "Marked paid")}>Save</Button><Button size="sm" variant="ghost" onClick={() => setPaying(null)}>×</Button></span>
                    ) : editing?.id === e.id ? (
                      <span className="inline-flex gap-1"><input aria-label="Amount" className={`${toolbarControl} w-24`} inputMode="decimal" value={editing.amount} onChange={(ev) => setEditing({ ...editing, amount: ev.target.value })} />{e.status === "template" ? <input aria-label="Ends" type="date" className={toolbarControl} value={editing.end} onChange={(ev) => setEditing({ ...editing, end: ev.target.value })} /> : null}<Button size="sm" disabled={busy === e.id || parseDollarsToCents(editing.amount) === null} onClick={() => void act(e.id, { amount_cents: parseDollarsToCents(editing.amount), ...(e.status === "template" ? { recurrence_end_on: editing.end || null } : {}) }, e.status === "template" ? "Saved: future months only" : "Saved", "PATCH")}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>×</Button></span>
                    ) : (
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        {e.status === "unconfirmed" ? <Button size="sm" disabled={busy === e.id} onClick={() => void act(e.id, { action: "confirm" }, "Booked")}>Confirm</Button> : null}
                        {e.status === "confirmed" && !e.paidOn ? <Button size="sm" variant="outline" onClick={() => setPaying({ id: e.id, on: today(), method: "card" })}>Mark paid</Button> : null}
                        {e.status === "template" || e.status === "unconfirmed" ? <Button size="sm" variant="outline" onClick={() => setEditing({ id: e.id, amount: formatCentsAsCurrency(e.amountCents).replace(/[$,]/g, ""), end: e.recurrenceEndOn ?? "" })}>Edit</Button> : null}
                        {e.status === "confirmed" || e.status === "unconfirmed" ? <Button size="sm" variant="outline" onClick={() => setVoiding({ id: e.id, reason: "" })}>{e.status === "unconfirmed" ? "Skip" : "Void"}</Button> : null}
                        {e.status === "confirmed" ? (e.hasReceipt
                          ? <a className="inline-flex h-9 items-center px-2 text-sm underline" href={`/api/app/accounting/expenses/${e.id}`} target="_blank" rel="noreferrer">Receipt</a>
                          : <label className="inline-flex h-9 cursor-pointer items-center px-2 text-sm underline">Receipt<input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={(ev) => { const file = ev.target.files?.[0]; if (file) void upload(e.id, file); ev.target.value = ""; }} /></label>) : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {creating ? <NewExpense defaults={defaults} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} /> : null}
    </>
  );
}
