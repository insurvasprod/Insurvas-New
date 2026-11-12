"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { TableCard } from "@/components/ui/table-card";
import { EXPENSE_BUCKET_COPY, bucketOf, monthName, shiftMonth, type ExpenseCategory } from "@/lib/accounting/expensesCore";
import { PAID_METHOD_LABELS, PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html boards 3·2–3·4): the expense page's pop-ups.
 * The OK dialog (md, stepping through the To OK list), the fact dialog every Details row opens (md), and the
 * Receipt tab's drop zone. The mockup draws these as `Dialog md`, not confirms: each holds a short edit and keeps
 * the expense behind it. Confirms (Skip, Void, Mark paid) stay `ConfirmDialog`s in expenses-board.tsx.
 */
const money = (cents: number) => formatCentsAsCurrency(cents);
const today = () => new Date().toISOString().slice(0, 10);

export async function sendExpense(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

/** What the OK dialog needs of each bill it steps through. */
export type OkItem = { id: string; vendorName: string; amountCents: number; category: ExpenseCategory; isAcquisitionCost: boolean; incurredOn: string };

/**
 * "OK CloseRight CRM for November?" with Paid on, Paid by and an optional reference; Skip this month (a confirm),
 * Keep it, and OK and next › while there are more to go. OK books the bill and stamps it paid (ok_expense).
 */
export function OkDialog({ queue, open, onOpenChange }: { queue: OkItem[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [at, setAt] = useState(0);
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState("card");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [okd, setOkd] = useState(0);
  const item = queue[at];
  if (!item) return null;
  const last = at >= queue.length - 1;
  const month = monthName(item.incurredOn).split(" ")[0];
  const finish = (count: number) => {
    if (count > 1) notify.done(`${count} bills OK'd and marked paid`);
    else if (count === 1) notify.done("OK'd: booked and marked paid");
    onOpenChange(false);
    router.refresh();
  };
  const advance = (count: number) => {
    if (last) { finish(count); return; }
    setAt(at + 1);
    setReference("");
  };
  const ok = async () => {
    setBusy(true);
    try {
      await sendExpense(`/api/app/accounting/expenses/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ok", paid_on: paidOn, method, reference: reference.trim() || null }) });
      setOkd(okd + 1);
      advance(okd + 1);
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const skip = async () => {
    setBusy(true);
    try {
      await sendExpense(`/api/app/accounting/expenses/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "void", reason: "Skipped this month" }) });
      notify.done(`Skipped: nothing is booked for ${month}`);
      setSkipping(false);
      advance(okd);
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const close = (next: boolean) => {
    if (busy) return;
    if (!next && okd > 0) { finish(okd); return; }
    onOpenChange(next);
  };
  return (
    <>
      <Dialog open={open && !skipping} onOpenChange={close}>
        <DialogContent size="md">
          <DialogHeader>
            <div className="flex items-baseline gap-3 pr-6">
              <DialogTitle className="min-w-0 flex-1">OK {item.vendorName} for {month}?</DialogTitle>
              {queue.length > 1 ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{at + 1} of {queue.length}</span> : null}
            </div>
            <DialogDescription className="text-[var(--body)]">
              {money(item.amountCents)} · {EXPENSE_BUCKET_COPY[bucketOf(item.category)].short} · {item.isAcquisitionCost ? "Acquisition" : "Overhead"}. OK books it and marks it paid. Nothing is paid from here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid on" htmlFor="ok-paid-on"><input id="ok-paid-on" type="date" className={control} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              <Field label="Paid by" htmlFor="ok-method"><select id="ok-method" className={control} value={method} onChange={(e) => setMethod(e.target.value)}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field>
            </div>
            <Field label="Reference (optional)" htmlFor="ok-ref"><input id="ok-ref" className={control} maxLength={200} placeholder="As on the card statement" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setSkipping(true)}>Skip this month</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>Keep it</Button>
              <Button type="button" disabled={busy || !paidOn} onClick={() => void ok()}>{last ? "OK it" : "OK and next ›"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={open && skipping}
        onOpenChange={(next) => { if (!next) setSkipping(false); }}
        busy={busy}
        destructive={false}
        title={`Skip ${item.vendorName} this month?`}
        description={`Nothing is booked for ${month}. It comes back in ${monthName(shiftMonth(item.incurredOn.slice(0, 7), 1)).split(" ")[0]}.`}
        confirmLabel="Skip"
        cancelLabel="Keep it"
        onConfirm={() => void skip()}
      />
    </>
  );
}

/** A Details row's pop-up (md): what changes, where it reaches, Cancel and Save; `left` holds "Back to the default". */
export function FactDialog({ open, onOpenChange, title, description, children, left, busy = false, saveLabel = "Save", cancelLabel = "Cancel", saveDisabled = false, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  left?: ReactNode;
  busy?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  saveDisabled?: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription className="text-[var(--body)]">{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!saveDisabled && !busy) onSave(); }}>
          {children}
          <DialogFooter className="sm:justify-between">
            <div>{left}</div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
              <Button type="submit" disabled={busy || saveDisabled}>{saveLabel}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Receipt tab (board 3·2): a drop zone until a file is attached, then the file, opened through a 60-second
 * link. Read-only plans open it and cannot replace it.
 */
export function ExpenseReceipt({ id, documentName, hasReceipt, canAttach, reason }: { id: string; documentName: string | null; hasReceipt: boolean; canAttach: boolean; reason: string | null }) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const upload = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    setBusy(true);
    try {
      await sendExpense(`/api/app/accounting/expenses/${id}`, { method: "PATCH", body: form });
      notify.done("Receipt attached");
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "The file didn't upload");
    } finally {
      setBusy(false);
    }
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && canAttach) void upload(file);
  };
  const choose = (
    <span title={canAttach ? undefined : reason ?? undefined}>
      <Button type="button" variant={hasReceipt ? "outline" : "default"} disabled={!canAttach || busy} onClick={() => picker.current?.click()}>{hasReceipt ? "Replace the receipt" : "Choose a file"}</Button>
    </span>
  );
  return (
    <TableCard footer={<span>PDF, PNG or JPEG, up to 10 MB. Only owners and bookkeepers can open it.</span>}>
      {hasReceipt ? (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>File</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            <tr>
              <td className="whitespace-nowrap"><a className="font-medium text-foreground hover:underline" href={`/api/app/accounting/expenses/${id}`} target="_blank" rel="noreferrer">{documentName ?? "The receipt"}</a></td>
              <td className="text-right"><span className="inline-flex gap-2"><Button variant="outline" asChild><a href={`/api/app/accounting/expenses/${id}`} target="_blank" rel="noreferrer">Open the receipt</a></Button>{choose}</span></td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div
          className={`m-4 flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center ${over ? "border-[var(--primary)]" : "border-[var(--border-strong)]"}`}
          onDragOver={(e) => { e.preventDefault(); if (canAttach) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <p className="text-sm font-semibold text-foreground">No receipt yet</p>
          <p className="max-w-[52ch] text-sm text-muted-foreground">{canAttach ? "Drop the receipt here, or choose the file." : reason ?? "The receipt can't be attached here."}</p>
          <div className="mt-2">{choose}</div>
        </div>
      )}
      <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".pdf,.png,.jpg,.jpeg" onChange={(ev) => { const file = ev.target.files?.[0]; if (file) void upload(file); ev.target.value = ""; }} />
    </TableCard>
  );
}
