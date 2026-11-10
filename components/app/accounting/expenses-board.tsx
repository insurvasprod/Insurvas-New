"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Field, control } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import {
  ACQUISITION_CONSEQUENCE,
  EXPENSE_BUCKET_COPY,
  EXPENSE_BUCKETS,
  EXPENSE_CATEGORY_LABELS,
  RECURRENCE_LABELS,
  bucketOf,
  categoriesIn,
  defaultCategoryFor,
  type ExpenseBucket,
  type ExpenseCategory,
} from "@/lib/accounting/expensesCore";
import type { ExpenseRow } from "@/lib/accounting/expenseStore";
import { PAID_METHOD_LABELS, PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.3 · everything spent that is not a lead. Recurring ones arrive each month unconfirmed and
 * book nothing until confirmed here — a cancelled subscription must not keep costing money in the
 * P&L because nobody said so. Each expense is acquisition or overhead, and the choice is shown.
 *
 * Foundation pass (2026-11-03): To confirm · Booked · Recurring are the step's tabs on the title line
 * (`?view=`); adding an expense is its own page (/app/expenses/new); a row has one primary action and a
 * menu, and every step that needs a reason or a date is a confirm pop-up.
 *
 * Expenses tracker (owner, 2026-11-06): three buckets (leads, subscriptions, daily & random) on a short
 * form; a monthly bill comes back as a to-do and its OK books it and marks it paid in one step; and a
 * Scoreboard tab says where the month's money went.
 */
export type ExpenseView = "scoreboard" | "confirm" | "booked" | "recurring";
const money = (cents: number) => formatCentsAsCurrency(cents);
const today = () => new Date().toISOString().slice(0, 10);
const plain = (cents: number) => formatCentsAsCurrency(cents).replace(/[$,]/g, "");

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

/**
 * /app/expenses/new (owner, 2026-11-06): the four questions first — what is it, how much, which bucket, and
 * does it come back every month — then More details for the rest (the date, the detailed category, counts
 * as, when it was paid, a note). Discard and Save, and a leave guard.
 */
export function ExpenseForm({ defaults }: { defaults: Record<ExpenseCategory, boolean> }) {
  const router = useRouter();
  const blank = { bucket: "subscriptions" as ExpenseBucket, what: "", amount: "", monthly: true, category: defaultCategoryFor("subscriptions"), on: today(), end: "", acq: "default", paidOn: today(), method: "card", note: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const pickBucket = (bucket: ExpenseBucket) => setF((cur) => ({ ...cur, bucket, category: defaultCategoryFor(bucket), monthly: bucket === "subscriptions" }));
  const fallback = defaults[f.category];
  const dirty = Boolean(f.what || f.amount || f.note);
  const save = async (): Promise<boolean> => {
    const cents = parseDollarsToCents(f.amount);
    if (!f.what.trim()) { setError("Say what it is, for example \"Dialer\" or \"100 leads from XYZ\"."); return false; }
    if (cents === null || cents <= 0) { setError("Enter how much, in dollars and cents."); return false; }
    setBusy(true);
    setError(null);
    try {
      const body = await send("/api/app/accounting/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: f.category, vendor_name: f.what.trim(), description: f.note.trim() || null, amount_cents: cents, incurred_on: f.on, recurrence: f.monthly ? "monthly" : "one_off",
          recurrence_end_on: f.monthly && f.end ? f.end : null, is_acquisition_cost: f.acq === "default" ? null : f.acq === "yes",
          ...(!f.monthly && f.paidOn ? { paid_on: f.paidOn, paid_method: f.method } : {}),
        }),
      });
      notify.done(f.monthly ? `Monthly bill set up${body.generated ? `: ${body.generated} month${body.generated === 1 ? "" : "s"} to OK` : ". It comes back each month for you to OK."}` : f.paidOn ? "Expense added and marked paid" : "Expense added");
      setF(blank);
      router.push(f.monthly ? (body.generated ? "/app/expenses?view=confirm" : "/app/expenses?view=recurring") : "/app/expenses?view=booked");
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
  return (
    <form ref={scope} onSubmit={submit} className={`${cardSurface} flex flex-col gap-5 p-5`}>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 text-sm font-medium">Which bucket?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {EXPENSE_BUCKETS.map((b) => (
            <label key={b} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${f.bucket === b ? "border-[var(--accent)] bg-[var(--primary-soft)]" : "border-border"}`}>
              <input type="radio" name="expense-bucket" className="mt-1" checked={f.bucket === b} onChange={() => pickBucket(b)} />
              <span className="min-w-0"><span className="block font-medium">{EXPENSE_BUCKET_COPY[b].label}</span><span className="block text-xs text-muted-foreground">{EXPENSE_BUCKET_COPY[b].hint}</span></span>
            </label>
          ))}
        </div>
        {f.bucket === "leads" ? <p className="mb-0 mt-2 text-xs text-muted-foreground">Got an invoice from the lead vendor? <Link className="underline" href="/app/vendor-bills/new">Enter it in Vendor bills</Link> instead, so it is checked against the leads you received.</p> : null}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="What is it?" htmlFor="exp-what" required><input id="exp-what" className={control} required maxLength={120} value={f.what} onChange={(e) => set("what", e.target.value)} placeholder={f.bucket === "leads" ? "e.g. 100 leads from XYZ" : f.bucket === "subscriptions" ? "e.g. Dialer" : "e.g. Office supplies"} /></Field>
        <Field label="How much? ($)" htmlFor="exp-amount" required><input id="exp-amount" className={control} required inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.monthly} onChange={(e) => set("monthly", e.target.checked)} />Comes back every month</label>
        </div>
      </div>
      <p className="m-0 text-xs text-muted-foreground">{f.monthly ? "Each month it comes back as a to-do for you to OK. OK books it and marks it paid; nothing is paid without you." : "Added for the day below and marked paid on the date in More details."}</p>
      <details className="rounded-lg border border-border px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">More details</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label={f.monthly ? "First month" : "For the day"} htmlFor="exp-on" required><input id="exp-on" type="date" className={control} required value={f.on} onChange={(e) => set("on", e.target.value)} /></Field>
          {f.monthly
            ? <Field label="Ends (optional)" htmlFor="exp-end"><input id="exp-end" type="date" className={control} value={f.end} onChange={(e) => set("end", e.target.value)} /></Field>
            : <Field label="Paid on (empty if not paid yet)" htmlFor="exp-paid"><input id="exp-paid" type="date" className={control} value={f.paidOn} onChange={(e) => set("paidOn", e.target.value)} /></Field>}
          {!f.monthly && f.paidOn ? <Field label="Paid by" htmlFor="exp-method"><select id="exp-method" className={control} value={f.method} onChange={(e) => set("method", e.target.value)}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field> : null}
          <Field label="Detail" htmlFor="exp-category" hint="Used by the P&L and the tax export."><select id="exp-category" className={control} value={f.category} onChange={(e) => set("category", e.target.value as ExpenseCategory)}>{categoriesIn(f.bucket).map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}</select></Field>
          <Field label="Counts as" htmlFor="exp-acq" hint={ACQUISITION_CONSEQUENCE}>
            <select id="exp-acq" className={control} value={f.acq} onChange={(e) => set("acq", e.target.value)}>
              <option value="default">{fallback ? "Acquisition" : "Overhead"} — the default for {EXPENSE_CATEGORY_LABELS[f.category].toLowerCase()}</option>
              <option value={fallback ? "no" : "yes"}>{fallback ? "Overhead" : "Acquisition"} — your choice for this one</option>
            </select>
          </Field>
          <Field label="Note" htmlFor="exp-note"><input id="exp-note" className={control} maxLength={500} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
        </div>
      </details>
      {error ? <Callout tone="error" title={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" asChild><Link href="/app/expenses">Discard</Link></Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : f.monthly ? "Set up monthly bill" : "Add expense"}</Button>
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setF(blank)} what="this expense" />
    </form>
  );
}

/** The step's header: Add an expense, and OK all on the To OK tab (each booked and marked paid today). */
export function ExpenseActions({ unconfirmedIds, view, readOnly }: { unconfirmedIds: string[]; view: ExpenseView; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (readOnly) return null;
  const confirmAll = async () => {
    setBusy(true);
    let n = 0;
    try {
      for (const id of unconfirmedIds) {
        await send(`/api/app/accounting/expenses/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ok" }) });
        n += 1;
      }
      notify.done(`${n} bill${n === 1 ? "" : "s"} OK'd and marked paid`);
    } catch (err) {
      notify.fail(err instanceof Error ? `${n} OK'd, then: ${err.message}` : "That didn't save");
    } finally {
      setBusy(false);
      router.refresh();
    }
  };
  return (
    <>
      {view === "confirm" && unconfirmedIds.length ? <Button variant="outline" disabled={busy} onClick={() => void confirmAll()}>OK all {unconfirmedIds.length}</Button> : null}
      <Button asChild><Link href="/app/expenses/new">Add an expense</Link></Button>
    </>
  );
}

type Asking = { kind: "void" | "paid" | "edit"; row: ExpenseRow; reason: string; on: string; method: string; reference: string; amount: string; end: string };

export function ExpensesBoard({ expenses, view, readOnly, openId = null }: { expenses: ExpenseRow[]; view: ExpenseView; readOnly: boolean; openId?: string | null }) {
  const router = useRouter();
  const unconfirmed = expenses.filter((e) => e.status === "unconfirmed");
  // ?open={id} (a P&L drill-through) opens the view and page holding that expense, and marks its row.
  const target = openId ? expenses.find((e) => e.id === openId) ?? null : null;
  const [q, setQ] = useState("");
  const pageSize = useFittingPageSize(480, 45);
  const templates = expenses.filter((e) => e.status === "template");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = view === "confirm" ? expenses.filter((e) => e.status === "unconfirmed") : view === "recurring" ? expenses.filter((e) => e.status === "template") : expenses.filter((e) => e.status === "confirmed" || e.status === "void");
    return base.filter((e) => !needle || e.vendorName.toLowerCase().includes(needle) || (e.description ?? "").toLowerCase().includes(needle));
  }, [expenses, view, q]);
  // Until someone pages, the page follows the target row, so a re-fitted page size still shows it.
  const [picked, setPage] = useState<number | null>(null);
  const targetIndex = target ? Math.max(rows.findIndex((e) => e.id === target.id), 0) : 0;
  const page = picked ?? Math.floor(targetIndex / pageSize) + 1;
  useEffect(() => {
    if (target) document.getElementById(`expense-${target.id}`)?.scrollIntoView({ block: "center" });
  }, [target]);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const fileFor = useRef<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const act = async (id: string, payload: Record<string, unknown>, done: string, method = "POST") => {
    setBusy(id);
    try {
      await send(`/api/app/accounting/expenses/${id}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      notify.done(done);
      setAsking(null);
      refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(null);
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
  const ask = (kind: Asking["kind"], row: ExpenseRow) => setAsking({ kind, row, reason: "", on: today(), method: "card", reference: "", amount: plain(row.amountCents), end: row.recurrenceEndOn ?? "" });
  const confirmAsked = () => {
    if (!asking) return;
    const { row } = asking;
    if (asking.kind === "void") void act(row.id, { action: "void", reason: asking.reason }, row.status === "confirmed" ? "Voided: the cost is reversed" : "Skipped");
    else if (asking.kind === "paid") void act(row.id, { action: "paid", paid_on: asking.on, method: asking.method, reference: asking.reference.trim() || null }, "Marked paid");
    else void act(row.id, { amount_cents: parseDollarsToCents(asking.amount), ...(row.status === "template" ? { recurrence_end_on: asking.end || null } : {}) }, row.status === "template" ? "Saved: future months only" : "Saved", "PATCH");
  };

  const month = today().slice(0, 7);
  const bookedThisMonth = expenses.filter((e) => e.status === "confirmed" && e.incurredOn.startsWith(month));
  const acq = bookedThisMonth.filter((e) => e.isAcquisitionCost).reduce((s, e) => s + e.amountCents, 0);
  const over = bookedThisMonth.filter((e) => !e.isAcquisitionCost).reduce((s, e) => s + e.amountCents, 0);
  const shown = paginate(rows, page, pageSize);

  return (
    <>
      <StatStrip label="Expense totals">
        <StatTile label="To OK" value={String(unconfirmed.length)} valueTone={unconfirmed.length ? "warning" : undefined} footnote={money(unconfirmed.reduce((s, e) => s + e.amountCents, 0))} href="/app/expenses" />
        <StatTile label="Acquisition this month" value={money(acq)} footnote="in cost per policy" href="/app/expenses?view=booked" />
        <StatTile label="Overhead this month" value={money(over)} footnote="net profit only" href="/app/expenses?view=booked" />
        <StatTile label="Monthly bills" value={String(templates.length)} footnote="come back each month" href="/app/expenses?view=recurring" />
      </StatStrip>
      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search what it was" />
          </DataToolbar>
        }
        footer={rows.length > pageSize ? <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="expenses" onPage={setPage} /> : undefined}
      >
        {expenses.length === 0 ? (
          <EmptyState title="No expenses yet" hint="Add the dialer, the CRM, the lead spend: without them cost per policy is too low." action={!readOnly ? <Button asChild><Link href="/app/expenses/new">Add an expense</Link></Button> : undefined} />
        ) : rows.length === 0 ? (
          q ? <NoMatches noun="expenses" onClear={() => setQ("")} />
            : view === "confirm" ? <EmptyState title="Nothing to OK" hint="Every monthly bill that came back is booked and paid." />
            : view === "recurring" ? <EmptyState title="No monthly bills" hint="Tick “Comes back every month” when you add one, and each month it comes back here to OK." action={!readOnly ? <Button asChild variant="outline"><Link href="/app/expenses/new">Add an expense</Link></Button> : undefined} />
            : <EmptyState title="Nothing paid yet" hint="Expenses you add, and monthly bills you OK, are listed here." />
        ) : (
          <table className="portal-lead-table w-full min-w-190 text-left text-sm">
            <thead><tr><th>What</th><th className="w-26">{view === "recurring" ? "From" : "Period"}</th><th className="w-26 text-right">Amount</th><th className="w-36">Counts as</th><th className="w-36">{view === "recurring" ? "Repeats" : "Status"}</th><th className="w-32 text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.rows.map((e) => {
                const primary = e.status === "unconfirmed" ? <Button size="sm" disabled={busy === e.id} onClick={() => void act(e.id, { action: "ok" }, "OK'd: booked and marked paid")}>OK</Button>
                  : e.status === "confirmed" && !e.paidOn ? <Button size="sm" variant="outline" onClick={() => ask("paid", e)}>Mark paid</Button>
                  : null;
                return (
                  <tr key={e.id} id={`expense-${e.id}`} aria-current={e.id === target?.id ? "true" : undefined} className={e.id === target?.id ? "bg-[var(--surface-alt)]" : undefined}>
                    <td className="min-w-[180px]"><div className="max-w-52 truncate font-medium">{e.vendorName}</div><div className="max-w-52 truncate text-xs text-muted-foreground" title={[EXPENSE_BUCKET_COPY[bucketOf(e.category)].short, EXPENSE_CATEGORY_LABELS[e.category], e.description].filter(Boolean).join(" · ")}>{EXPENSE_BUCKET_COPY[bucketOf(e.category)].short} · {EXPENSE_CATEGORY_LABELS[e.category]}{e.description ? ` · ${e.description}` : ""}{e.hasReceipt ? "" : e.status === "confirmed" ? " · no receipt" : ""}</div></td>
                    <td>{e.incurredOn}{e.status === "template" && e.recurrenceEndOn ? <div className="text-xs text-muted-foreground">until {e.recurrenceEndOn}</div> : null}</td>
                    <td className="text-right tabular-nums">{money(e.amountCents)}</td>
                    <td>
                      <select aria-label="Acquisition or overhead" className={toolbarControl} disabled={readOnly || e.status === "void" || busy === e.id} value={e.isAcquisitionCost ? "yes" : "no"}
                        onChange={(ev) => void act(e.id, { action: "classify", is_acquisition_cost: ev.target.value === "yes" }, "Saved")}>
                        <option value="yes">Acquisition</option><option value="no">Overhead</option>
                      </select>
                      {e.acquisitionOverridden ? <div className="text-xs text-muted-foreground">Overrides the category default</div> : null}
                    </td>
                    <td>
                      {e.status === "template" ? RECURRENCE_LABELS[e.recurrence]
                        : e.status === "unconfirmed" ? <StatusChip tone="warning">Waiting for OK</StatusChip>
                        : e.status === "void" ? <StatusChip tone="neutral">Void</StatusChip>
                        : <StatusChip tone={e.paidOn ? "good" : "info"}>{e.paidOn ? `Paid ${e.paidOn}` : "Booked, unpaid"}</StatusChip>}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center justify-end gap-1">
                        {readOnly ? null : primary}
                        <MoreMenu row label={`More for ${e.vendorName}`} items={[
                          !readOnly && (e.status === "template" || e.status === "unconfirmed") && { label: "Edit the amount", onSelect: () => ask("edit", e) },
                          !readOnly && (e.status === "confirmed" || e.status === "unconfirmed") && { label: e.status === "unconfirmed" ? "Skip this period" : "Void", onSelect: () => ask("void", e) },
                          e.status === "confirmed" && e.hasReceipt && { label: "Open the receipt", href: `/api/app/accounting/expenses/${e.id}` },
                          !readOnly && e.status === "confirmed" && { label: e.hasReceipt ? "Replace the receipt" : "Attach the receipt", onSelect: () => { fileFor.current = e.id; picker.current?.click(); } },
                        ]} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
      <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".pdf,.png,.jpg,.jpeg" onChange={(ev) => { const file = ev.target.files?.[0]; if (file && fileFor.current) void upload(fileFor.current, file); ev.target.value = ""; }} />
      {asking ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => { if (!next) setAsking(null); }}
          busy={busy === asking.row.id}
          destructive={asking.kind === "void"}
          title={asking.kind === "void" ? (asking.row.status === "unconfirmed" ? `Skip ${asking.row.vendorName} this period?` : `Void ${asking.row.vendorName}?`) : asking.kind === "paid" ? `Mark ${asking.row.vendorName} paid?` : `Change ${asking.row.vendorName}'s amount?`}
          description={asking.kind === "void" ? (asking.row.status === "confirmed" ? "The cost is reversed; the original entry stays on record." : "Nothing is booked for this period.") : asking.kind === "paid" ? "Records when the money moved. Nothing is paid from here." : asking.row.status === "template" ? "Future periods only; what is already booked keeps its amount." : undefined}
          confirmLabel={asking.kind === "void" ? (asking.row.status === "unconfirmed" ? "Skip" : "Void expense") : asking.kind === "paid" ? "Mark paid" : "Save"}
          cancelLabel="Keep it"
          confirmDisabled={asking.kind === "void" ? !asking.reason.trim() : asking.kind === "edit" ? parseDollarsToCents(asking.amount) === null : !asking.on}
          onConfirm={confirmAsked}
          fields={asking.kind === "void" ? (
            <Field label="Why?" htmlFor="exp-why"><input id="exp-why" className={control} autoFocus maxLength={500} value={asking.reason} onChange={(ev) => setAsking({ ...asking, reason: ev.target.value })} /></Field>
          ) : asking.kind === "paid" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid on" htmlFor="exp-paid-on"><input id="exp-paid-on" type="date" className={control} value={asking.on} onChange={(ev) => setAsking({ ...asking, on: ev.target.value })} /></Field>
              <Field label="Method" htmlFor="exp-method"><select id="exp-method" className={control} value={asking.method} onChange={(ev) => setAsking({ ...asking, method: ev.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field>
              <Field label="Reference (optional)" htmlFor="exp-ref" className="col-span-2"><input id="exp-ref" className={control} maxLength={200} value={asking.reference} onChange={(ev) => setAsking({ ...asking, reference: ev.target.value })} /></Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount ($)" htmlFor="exp-edit-amount"><input id="exp-edit-amount" className={control} inputMode="decimal" autoFocus value={asking.amount} onChange={(ev) => setAsking({ ...asking, amount: ev.target.value })} /></Field>
              {asking.row.status === "template" ? <Field label="Ends" htmlFor="exp-edit-end"><input id="exp-edit-end" type="date" className={control} value={asking.end} onChange={(ev) => setAsking({ ...asking, end: ev.target.value })} /></Field> : null}
            </div>
          )}
        />
      ) : null}
    </>
  );
}
