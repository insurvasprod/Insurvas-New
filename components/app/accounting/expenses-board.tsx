"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";

import { ClickRow } from "@/components/app/book/policy/click-row";
import { FactDialog, OkDialog, sendExpense, type OkItem } from "@/components/app/accounting/expense-record";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Field, checkboxControl, control, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import {
  ACQUISITION_CONSEQUENCE,
  EXPENSE_BUCKET_COPY,
  EXPENSE_BUCKETS,
  EXPENSE_CATEGORY_LABELS,
  bucketOf,
  categoriesIn,
  defaultCategoryFor,
  expenseFor,
  expenseHref,
  expenseState,
  inExpenseList,
  isMonthly,
  monthName,
  nextStepFor,
  shortDate,
  type ExpenseBucket,
  type ExpenseCategory,
  type ExpenseList,
} from "@/lib/accounting/expensesCore";
import type { ExpenseRow, MonthScoreboard } from "@/lib/accounting/expenseStore";
import { PAID_METHOD_LABELS, PAID_METHODS, type PaidMethod } from "@/lib/accounting/invoicesCore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.3 · everything spent that is not a lead invoice. Recurring ones arrive each month unconfirmed and
 * book nothing until OK'd — a cancelled subscription must not keep costing money in the P&L because nobody
 * said so. Each expense is acquisition or overhead, and the choice is shown.
 *
 * Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html §3, direction 3·A "One strip, rows open the
 * expense"): Scoreboard · To OK · All expenses · Monthly bills, the Scoreboard's strip on every tab, and rows
 * that carry no controls: a row opens the expense's own page (/app/expenses/[id]), where Counts as, OK, Mark
 * paid, the amount, Skip / Void and the receipt live. Adding an expense is a page of four numbered questions.
 */
export type ExpenseView = "scoreboard" | "confirm" | "booked" | "recurring";
const money = (cents: number) => formatCentsAsCurrency(cents);
const today = () => new Date().toISOString().slice(0, 10);
const plain = (cents: number) => formatCentsAsCurrency(cents).replace(/[$,]/g, "");
const READ_ONLY = "This plan is read-only here: expenses can be seen, not changed.";
const HISTORY = "A booked expense is history: void it and enter it again.";

/** A button that is off, with its reason on hover (a disabled button takes no pointer events itself). */
function Off({ reason, children }: { reason: string; children: ReactNode }) {
  return <span title={reason} className="inline-flex">{children}</span>;
}

const okItemOf = (e: ExpenseRow): OkItem => ({ id: e.id, vendorName: e.vendorName, amountCents: e.amountCents, category: e.category, isAcquisitionCost: e.isAcquisitionCost, incurredOn: e.incurredOn });

function StateChip({ e }: { e: Pick<ExpenseRow, "status" | "paidOn"> }) {
  const state = expenseState(e);
  if (state === "waiting") return <StatusChip tone="warning">Waiting for OK</StatusChip>;
  if (state === "unpaid") return <StatusChip tone="warning">Booked, unpaid</StatusChip>;
  if (state === "paid") return <StatusChip tone="good">Paid {shortDate(e.paidOn!)}</StatusChip>;
  if (state === "void") return <StatusChip tone="neutral">Void</StatusChip>;
  return <StatusChip tone="neutral">Monthly bill</StatusChip>;
}

// ─── Add an expense (board 3·3) ─────────────────────────────────────────────────────────────────

type Draft = { bucket: ExpenseBucket; what: string; amount: string; monthly: boolean; category: ExpenseCategory; on: string; end: string; acq: string; paidOn: string; method: string; note: string };
const blankDraft = (): Draft => ({ bucket: "subscriptions", what: "", amount: "", monthly: true, category: defaultCategoryFor("subscriptions"), on: today(), end: "", acq: "default", paidOn: today(), method: "card", note: "" });
const DraftContext = createContext<{ f: Draft; setF: (next: Draft | ((cur: Draft) => Draft)) => void; busy: boolean; setBusy: (busy: boolean) => void } | null>(null);

/** Holds the add form's draft, so its Save and Discard can sit on the title line (the frame's `actions`). */
export function ExpenseDraftProvider({ children }: { children: ReactNode }) {
  const [f, setF] = useState<Draft>(blankDraft);
  const [busy, setBusy] = useState(false);
  return <DraftContext.Provider value={{ f, setF, busy, setBusy }}>{children}</DraftContext.Provider>;
}
const useDraft = () => {
  const draft = useContext(DraftContext);
  if (!draft) throw new Error("ExpenseForm needs an ExpenseDraftProvider");
  return draft;
};

/** The add page's title-line buttons: Discard, and Save named for what it does. */
export function ExpenseFormActions() {
  const router = useRouter();
  const { f, setF, busy } = useDraft();
  return (
    <>
      <Button type="button" variant="ghost" disabled={busy} onClick={() => { setF(blankDraft()); router.push("/app/expenses"); }}>Discard</Button>
      <Button type="submit" form="expense-form" disabled={busy}>{f.monthly ? "Set up monthly bill" : "Add expense"}</Button>
    </>
  );
}

/**
 * /app/expenses/new (round 7, board 3·3): four numbered questions, nothing hidden in "More details". 1 · Which
 * bucket? 2 · What is it, and how much? 3 · When? 4 · How it counts. Save and Discard on the title line, and a
 * leave guard.
 */
export function ExpenseForm({ defaults }: { defaults: Record<ExpenseCategory, boolean> }) {
  const router = useRouter();
  const { f, setF, busy, setBusy } = useDraft();
  const [errors, setErrors] = useState<{ what?: string; amount?: string }>({});
  const scope = useRef<HTMLFormElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const pickBucket = (bucket: ExpenseBucket) => setF((cur) => ({ ...cur, bucket, category: defaultCategoryFor(bucket), monthly: bucket === "subscriptions" }));
  const fallback = defaults[f.category];
  const dirty = Boolean(f.what || f.amount || f.note);
  const save = async (): Promise<boolean> => {
    const cents = parseDollarsToCents(f.amount);
    const found = {
      what: f.what.trim() ? undefined : "Say what it is, for example \"Dialer\" or \"100 leads from XYZ\".",
      amount: cents !== null && cents > 0 ? undefined : "Enter how much, in dollars and cents.",
    };
    setErrors(found);
    if (found.what || found.amount || cents === null) return false;
    setBusy(true);
    try {
      const body = await sendExpense("/api/app/accounting/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: f.category, vendor_name: f.what.trim(), description: f.note.trim() || null, amount_cents: cents, incurred_on: f.on, recurrence: f.monthly ? "monthly" : "one_off",
          recurrence_end_on: f.monthly && f.end ? f.end : null, is_acquisition_cost: f.acq === "default" ? null : f.acq === "yes",
          ...(!f.monthly && f.paidOn ? { paid_on: f.paidOn, paid_method: f.method } : {}),
        }),
      });
      notify.done(f.monthly ? `Monthly bill set up${body.generated ? `: ${body.generated} month${body.generated === 1 ? "" : "s"} to OK` : ". It comes back each month for you to OK."}` : f.paidOn ? "Expense added and marked paid" : "Expense added");
      const monthly = f.monthly;
      setF(blankDraft());
      router.push(monthly && body.generated ? "/app/expenses?view=confirm" : body.id ? expenseHref(body.id) : "/app/expenses?view=booked");
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
  return (
    <form id="expense-form" ref={scope} onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>1 · Which bucket?</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          <div role="radiogroup" aria-label="Which bucket?" className="flex flex-wrap gap-2">
            {EXPENSE_BUCKETS.map((b) => <ToggleChip key={b} role="radio" selected={f.bucket === b} onClick={() => pickBucket(b)}>{EXPENSE_BUCKET_COPY[b].label}</ToggleChip>)}
          </div>
          <p className="m-0 text-xs text-muted-foreground">{EXPENSE_BUCKET_COPY[f.bucket].hint}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>2 · What is it, and how much?</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What is it?" htmlFor="exp-what" required error={errors.what}><input id="exp-what" className={control} maxLength={120} value={f.what} aria-invalid={errors.what ? true : undefined} onChange={(e) => set("what", e.target.value)} placeholder={f.bucket === "leads" ? "e.g. 100 leads from XYZ" : f.bucket === "subscriptions" ? "e.g. Dialer seats" : "e.g. Office supplies"} /></Field>
            <Field label="How much? ($)" htmlFor="exp-amount" required error={errors.amount}><input id="exp-amount" className={control} inputMode="decimal" value={f.amount} aria-invalid={errors.amount ? true : undefined} onChange={(e) => set("amount", e.target.value)} /></Field>
          </div>
          {f.bucket === "leads" ? <p className="m-0 text-xs text-muted-foreground">Got a bill from the lead vendor? <Link className="text-[var(--accent-ink)] underline" href="/app/vendor-bills/new">Enter it in Vendor bills</Link> instead.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>3 · When?</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={f.monthly ? "First month" : "For the day"} htmlFor="exp-on" required><input id="exp-on" type="date" className={control} required value={f.on} onChange={(e) => set("on", e.target.value)} /></Field>
            {f.monthly
              ? <Field label="Ends (optional)" htmlFor="exp-end"><input id="exp-end" type="date" className={control} value={f.end} placeholder="No end" onChange={(e) => set("end", e.target.value)} /></Field>
              : <Field label="Paid on (empty if not paid yet)" htmlFor="exp-paid"><input id="exp-paid" type="date" className={control} value={f.paidOn} onChange={(e) => set("paidOn", e.target.value)} /></Field>}
            {!f.monthly && f.paidOn ? <Field label="Paid by" htmlFor="exp-method"><select id="exp-method" className={control} value={f.method} onChange={(e) => set("method", e.target.value)}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field> : null}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className={checkboxControl} checked={f.monthly} onChange={(e) => set("monthly", e.target.checked)} />Comes back every month</label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>4 · How it counts</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Detail" htmlFor="exp-category" hint="Used by the P&L and the tax export."><select id="exp-category" className={control} value={f.category} onChange={(e) => set("category", e.target.value as ExpenseCategory)}>{categoriesIn(f.bucket).map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}</select></Field>
          <Field label="Counts as" htmlFor="exp-acq" hint={ACQUISITION_CONSEQUENCE}>
            <select id="exp-acq" className={control} value={f.acq} onChange={(e) => set("acq", e.target.value)}>
              <option value="default">{fallback ? "Acquisition" : "Overhead"} — the default for {EXPENSE_CATEGORY_LABELS[f.category]}</option>
              <option value={fallback ? "no" : "yes"}>{fallback ? "Overhead" : "Acquisition"} — your choice for this one</option>
            </select>
          </Field>
          <Field label="Note" htmlFor="exp-note" className="sm:col-span-2"><input id="exp-note" className={control} maxLength={500} placeholder="Only you see this" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
        </CardContent>
      </Card>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setF(blankDraft())} what="this expense" />
    </form>
  );
}

// ─── The list's title line and strip (board 3·A, 3·1) ───────────────────────────────────────────

/**
 * The step's title-line buttons. On To OK with bills waiting: Add an expense and OK N one by one (the OK dialog,
 * stepping); on the Scoreboard with bills waiting, OK N one by one; otherwise Add an expense.
 */
export function ExpenseActions({ toOk, view, readOnly }: { toOk: OkItem[]; view: ExpenseView; readOnly: boolean }) {
  const [stepping, setStepping] = useState(false);
  const add = (primary: boolean) => readOnly
    ? <Off reason={READ_ONLY}><Button variant={primary ? "default" : "outline"} disabled>Add an expense</Button></Off>
    : <Button variant={primary ? "default" : "outline"} asChild><Link href="/app/expenses/new">Add an expense</Link></Button>;
  const okLabel = toOk.length === 1 ? "OK it" : `OK ${toOk.length} one by one`;
  const ok = readOnly
    ? <Off reason={READ_ONLY}><Button disabled>{okLabel}</Button></Off>
    : <Button onClick={() => setStepping(true)}>{okLabel}</Button>;
  const stepsOk = toOk.length > 0 && (view === "confirm" || view === "scoreboard");
  return (
    <>
      {stepsOk ? <>{view === "confirm" ? add(false) : null}{ok}</> : add(true)}
      {stepping ? <OkDialog queue={toOk} open onOpenChange={setStepping} /> : null}
    </>
  );
}

/**
 * One strip, the Scoreboard's, on every tab (board 3·A): the month's total and its three buckets. Each tile is
 * the link to its rows.
 */
export function ExpenseMonthStrip({ board, subscriptionsToOkCents }: { board: MonthScoreboard; subscriptionsToOkCents: number }) {
  const { month } = board;
  const current = month === today().slice(0, 7);
  const short = `${monthName(month).slice(0, 3)} ${month.slice(0, 4)}`;
  const share = (cents: number) => (board.totalCents > 0 ? `${String(Math.trunc((cents * 1000 + board.totalCents * 5) / (board.totalCents * 10)))}% of the month` : "nothing yet");
  return (
    <StatStrip label={`Spent in ${monthName(month)}`}>
      <StatTile label={`Total spent · ${short}`} value={money(board.totalCents)} footnote={current ? "so far this month" : monthName(month)} href={`/app/expenses?view=scoreboard&month=${month}`} />
      <StatTile label="Leads" value={money(board.byBucket.leads)} footnote={`${share(board.byBucket.leads)} · from Vendor bills`} href="/app/vendor-bills" />
      <StatTile label="Subscriptions" value={money(board.byBucket.subscriptions)} footnote={`${share(board.byBucket.subscriptions)}${subscriptionsToOkCents ? ` · ${money(subscriptionsToOkCents)} to OK` : ""}`} href="/app/expenses?view=recurring" />
      <StatTile label="Daily & random" value={money(board.byBucket.daily)} footnote={share(board.byBucket.daily)} href="/app/expenses?view=booked" />
    </StatStrip>
  );
}

// ─── The lists (boards 3·A, 3·1) ───────────────────────────────────────────────────────────────

type StatusFilter = "all" | "paid" | "unpaid" | "void";
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [{ key: "all", label: "All" }, { key: "paid", label: "Paid" }, { key: "unpaid", label: "Booked, unpaid" }, { key: "void", label: "Void" }];

/** "Acquisition", one line; the override is said on hover. The row reads it, the expense's page changes it. */
function CountsAs({ e }: { e: ExpenseRow }) {
  return <td className="whitespace-nowrap" title={e.acquisitionOverridden ? "Overrides the category default" : undefined}>{e.isAcquisitionCost ? "Acquisition" : "Overhead"}</td>;
}

/** The first cell: the name, one line; its detail (category, how often, a missing receipt) on hover. */
function WhatCell({ e, extra = [] }: { e: ExpenseRow; extra?: (string | null | false)[] }) {
  return <td className="whitespace-nowrap font-medium text-foreground" title={[EXPENSE_CATEGORY_LABELS[e.category], ...extra].filter(Boolean).join(" · ")}>{e.vendorName}</td>;
}

export function ExpensesBoard({ expenses, view, readOnly, initialQuery = "", initialStatus = "all" }: { expenses: ExpenseRow[]; view: Exclude<ExpenseView, "scoreboard">; readOnly: boolean; initialQuery?: string; initialStatus?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState<StatusFilter>(STATUS_FILTERS.some((s) => s.key === initialStatus) ? (initialStatus as StatusFilter) : "all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const thisMonth = today().slice(0, 7);
  const list: ExpenseList = view === "confirm" ? "confirm" : view === "recurring" ? "recurring" : status;
  const base = useMemo(() => expenses.filter((e) => inExpenseList(e, view === "booked" ? "all" : list)), [expenses, view, list]);
  const counts = useMemo(() => Object.fromEntries(STATUS_FILTERS.map((s) => [s.key, base.filter((e) => inExpenseList(e, s.key)).length])) as Record<StatusFilter, number>, [base]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return base.filter((e) => (view !== "booked" || inExpenseList(e, status)) && (!needle || e.vendorName.toLowerCase().includes(needle) || (e.description ?? "").toLowerCase().includes(needle)));
  }, [base, view, status, q]);
  // This month's copy of each monthly bill, for the Monthly bills tab's "This month".
  const thisMonthCopy = useMemo(() => new Map(expenses.filter((e) => e.parentExpenseId && e.incurredOn.startsWith(thisMonth)).map((e) => [e.parentExpenseId!, e])), [expenses, thisMonth]);
  const shown = paginate(rows, page, pageSize);
  const addLink = (primary: boolean) => readOnly ? undefined : <Button asChild variant={primary ? "default" : "outline"}><Link href="/app/expenses/new">Add an expense</Link></Button>;
  const waitingTotal = rows.reduce((s, e) => s + e.amountCents, 0);

  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
          <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search what it was" />
          {view === "booked" ? (
            <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((s) => <ToggleChip key={s.key} role="radio" selected={status === s.key} count={counts[s.key]} countTone={s.key === "unpaid" && counts.unpaid ? "warning" : undefined} onClick={() => { setStatus(s.key); setPage(1); }}>{s.label}</ToggleChip>)}
            </div>
          ) : null}
        </DataToolbar>
      }
      footer={rows.length ? <>
        <span>{view === "confirm" ? `${rows.length} monthly bill${rows.length === 1 ? "" : "s"} came back · ${money(waitingTotal)}` : `${rows.length} ${view === "recurring" ? `monthly bill${rows.length === 1 ? "" : "s"}` : `expense${rows.length === 1 ? "" : "s"}`}`}</span>
        {rows.length > pageSize ? <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="expenses" onPage={setPage} /> : null}
      </> : undefined}
    >
      {expenses.length === 0 ? (
        <EmptyState title="No expenses yet" hint="Add the dialer, the CRM, the lead spend: without them cost per policy is too low." action={addLink(true)} />
      ) : rows.length === 0 ? (
        q ? <NoMatches noun="expenses" by="search" onClear={() => setQ("")} />
          : view === "confirm" ? <EmptyState title="Nothing to OK" hint="Every monthly bill that came back is booked and paid." action={addLink(false)} />
          : view === "recurring" ? <EmptyState title="No monthly bills" hint="Tick “Comes back every month” when you add one, and each month it comes back here to OK." action={addLink(false)} />
          : status !== "all" ? <NoMatches noun="expenses" onClear={() => setStatus("all")} />
          : <EmptyState title="Nothing booked yet" hint="Expenses you add, and monthly bills you OK, are listed here." action={addLink(false)} />
      ) : view === "confirm" ? (
        <table className="portal-lead-table w-full min-w-190 text-left text-sm">
          <thead><tr><th>What</th><th>Bucket</th><th>For</th><th className="text-right">Amount</th><th>Counts as</th><th>Next step</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {shown.rows.map((e) => (
              <ClickRow key={e.id} href={expenseHref(e.id, "confirm")} label={`Open ${e.vendorName}`}>
                <WhatCell e={e} extra={[isMonthly(e) ? "monthly" : "one-off", !e.hasReceipt && "no receipt"]} />
                <td className="whitespace-nowrap">{EXPENSE_BUCKET_COPY[bucketOf(e.category)].short}</td>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{expenseFor(e)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{money(e.amountCents)}</td>
                <CountsAs e={e} />
                <td className="whitespace-nowrap" title="Waiting for OK: OK it, or skip this month, on the expense's page">{nextStepFor(e)} ›</td>
              </ClickRow>
            ))}
          </tbody>
        </table>
      ) : view === "recurring" ? (
        <table className="portal-lead-table w-full min-w-190 text-left text-sm">
          <thead><tr><th>What</th><th className="text-right">Each month</th><th>Since</th><th>Ends</th><th>Counts as</th><th>This month</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {shown.rows.map((e) => {
              const copy = thisMonthCopy.get(e.id);
              return (
                <ClickRow key={e.id} href={expenseHref(e.id, "recurring")} label={`Open ${e.vendorName}`}>
                  <WhatCell e={e} extra={[EXPENSE_BUCKET_COPY[bucketOf(e.category)].short]} />
                  <td className="whitespace-nowrap text-right tabular-nums">{money(e.amountCents)}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{expenseFor(e)}</td>
                  <td className="whitespace-nowrap tabular-nums">{e.recurrenceEndOn ? <span className="text-muted-foreground">{shortDate(e.recurrenceEndOn)}</span> : "No end"}</td>
                  <CountsAs e={e} />
                  <td>{copy ? <Link href={expenseHref(copy.id, "months")} className="inline-flex"><StateChip e={copy} /></Link> : <StatusChip tone="neutral">Not back yet</StatusChip>}</td>
                </ClickRow>
              );
            })}
          </tbody>
        </table>
      ) : (
        <table className="portal-lead-table w-full min-w-160 text-left text-sm">
          <thead><tr><th>What</th><th>Bucket</th><th>For</th><th className="text-right">Amount</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {shown.rows.map((e) => (
              <ClickRow key={e.id} href={expenseHref(e.id, status)} label={`Open ${e.vendorName}`}>
                <WhatCell e={e} />
                <td className="whitespace-nowrap">{EXPENSE_BUCKET_COPY[bucketOf(e.category)].short}</td>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{expenseFor(e)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{money(e.amountCents)}</td>
                <td><StateChip e={e} /></td>
              </ClickRow>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

// ─── The expense page (boards 3·2, 3·4) ─────────────────────────────────────────────────────────

type Asking = { kind: "void" | "paid" | "skip"; row: ExpenseRow; reason: string; on: string; method: string; reference: string };

/** Mark paid, Void and Skip this month: the confirms the expense page asks, from its title line or a Details row. */
function useAsk() {
  const router = useRouter();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = (kind: Asking["kind"], row: ExpenseRow) => setAsking({ kind, row, reason: "", on: today(), method: "card", reference: "" });
  const act = async (payload: Record<string, unknown>, done: string) => {
    if (!asking) return;
    setBusy(true);
    try {
      await sendExpense(`/api/app/accounting/expenses/${asking.row.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      notify.done(done);
      setAsking(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const confirmAsked = () => {
    if (!asking) return;
    const month = monthName(asking.row.incurredOn).split(" ")[0];
    if (asking.kind === "void") void act({ action: "void", reason: asking.reason }, "Voided: the cost is reversed");
    else if (asking.kind === "skip") void act({ action: "void", reason: "Skipped this month" }, `Skipped: nothing is booked for ${month}`);
    else void act({ action: "paid", paid_on: asking.on, method: asking.method, reference: asking.reference.trim() || null }, "Marked paid");
  };
  const node = asking ? (
    <ConfirmDialog
      open
      onOpenChange={(next) => { if (!next) setAsking(null); }}
      busy={busy}
      destructive={asking.kind === "void"}
      title={asking.kind === "void" ? `Void ${asking.row.vendorName}?` : asking.kind === "skip" ? `Skip ${asking.row.vendorName} this month?` : `Mark ${asking.row.vendorName} paid?`}
      description={asking.kind === "void" ? "The cost is reversed; the original entry stays on record." : asking.kind === "skip" ? `Nothing is booked for ${monthName(asking.row.incurredOn).split(" ")[0]}. It comes back next month.` : "Records when the money moved. Nothing is paid from here."}
      confirmLabel={asking.kind === "void" ? "Void expense" : asking.kind === "skip" ? "Skip" : "Mark paid"}
      cancelLabel="Keep it"
      confirmDisabled={asking.kind === "void" ? !asking.reason.trim() : asking.kind === "paid" ? !asking.on : false}
      onConfirm={confirmAsked}
      fields={asking.kind === "void" ? (
        <Field label="Why?" htmlFor="exp-why"><input id="exp-why" className={control} autoFocus maxLength={500} placeholder="Entered twice" value={asking.reason} onChange={(ev) => setAsking({ ...asking, reason: ev.target.value })} /></Field>
      ) : asking.kind === "paid" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid on" htmlFor="exp-paid-on"><input id="exp-paid-on" type="date" className={control} value={asking.on} onChange={(ev) => setAsking({ ...asking, on: ev.target.value })} /></Field>
          <Field label="Paid by" htmlFor="exp-method"><select id="exp-method" className={control} value={asking.method} onChange={(ev) => setAsking({ ...asking, method: ev.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field>
          <Field label="Reference (optional)" htmlFor="exp-ref" className="col-span-2"><input id="exp-ref" className={control} maxLength={200} value={asking.reference} onChange={(ev) => setAsking({ ...asking, reference: ev.target.value })} /></Field>
        </div>
      ) : undefined}
    />
  ) : null;
  return { ask, node };
}

/**
 * The expense page's title-line buttons after its ‹ ›: More (Skip this month while it waits, Void once booked, the
 * receipt), then the one primary its status asks for: OK it (waiting), Mark paid (booked, unpaid), none (paid,
 * void, a monthly bill).
 */
export function ExpenseRecordActions({ row, readOnly, receiptHref }: { row: ExpenseRow; readOnly: boolean; receiptHref: string }) {
  const { ask, node } = useAsk();
  const [oking, setOking] = useState(false);
  const state = expenseState(row);
  const primary = state === "waiting" ? "OK it" : state === "unpaid" ? "Mark paid" : null;
  return (
    <>
      <MoreMenu items={[
        !readOnly && state === "waiting" && { label: "Skip this month", onSelect: () => ask("skip", row) },
        !readOnly && (state === "unpaid" || state === "paid") && { label: "Void", onSelect: () => ask("void", row) },
        row.hasReceipt && { label: "Open the receipt", href: `/api/app/accounting/expenses/${row.id}` },
        !readOnly && state !== "template" && state !== "void" && { label: row.hasReceipt ? "Replace the receipt" : "Attach the receipt", href: receiptHref },
      ]} />
      {primary ? (readOnly
        ? <Off reason={READ_ONLY}><Button disabled>{primary}</Button></Off>
        : <Button onClick={() => (state === "waiting" ? setOking(true) : ask("paid", row))}>{primary}</Button>) : null}
      {oking ? <OkDialog queue={[okItemOf(row)]} open onOpenChange={setOking} /> : null}
      {node}
    </>
  );
}

type FactKind = "amount" | "counts" | "detail" | "repeats" | "note";
type Fact = { key: string; label: string; value: ReactNode; usedBy: ReactNode; action?: { label: string; run: () => void } | { label: string; href: string }; off?: string };

/**
 * Details (board 3·2): a table of the expense's facts — Amount, Counts as, Detail, Repeats, Paid, Note — each row
 * opening its pop-up. A fact that cannot change says why on hover.
 */
export function ExpenseFacts({ row, defaults, readOnly, template, pnlHref }: { row: ExpenseRow; defaults: Record<ExpenseCategory, boolean>; readOnly: boolean; template: { href: string; name: string } | null; pnlHref: string | null }) {
  const router = useRouter();
  const { ask, node } = useAsk();
  const [oking, setOking] = useState(false);
  const [open, setOpen] = useState<FactKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(plain(row.amountCents));
  const [end, setEnd] = useState(row.recurrenceEndOn ?? "");
  const [acq, setAcq] = useState(row.isAcquisitionCost);
  const [category, setCategory] = useState<ExpenseCategory>(row.category);
  const [note, setNote] = useState(row.description ?? "");
  const state = expenseState(row);
  const detail = EXPENSE_CATEGORY_LABELS[row.category];
  const fallback = defaults[row.category];
  const editable = state === "template" || state === "waiting";
  const editOff = readOnly ? READ_ONLY : state === "void" ? "A void expense can't change." : editable ? undefined : HISTORY;
  const classifyOff = readOnly ? READ_ONLY : state === "void" ? "A void expense can't change." : undefined;
  const begin = (kind: FactKind) => {
    setAmount(plain(row.amountCents)); setEnd(row.recurrenceEndOn ?? ""); setAcq(row.isAcquisitionCost); setCategory(row.category); setNote(row.description ?? "");
    setOpen(kind);
  };
  const save = async (url: string, init: RequestInit, done: string) => {
    setBusy(true);
    try {
      await sendExpense(url, init);
      notify.done(done);
      setOpen(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Record<string, unknown>, done = state === "template" ? "Saved: future months only" : "Saved") =>
    void save(`/api/app/accounting/expenses/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, done);
  const classify = (value: boolean) =>
    void save(`/api/app/accounting/expenses/${row.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "classify", is_acquisition_cost: value }) }, "Saved");
  const cents = parseDollarsToCents(amount);
  const amountError = cents === null || cents <= 0 ? "Enter an amount above $0.00." : undefined;
  const paidMethod = row.paidMethod ? PAID_METHOD_LABELS[row.paidMethod as PaidMethod] ?? row.paidMethod : null;

  const facts: Fact[] = [
    {
      key: "amount", label: "Amount", value: <>{money(row.amountCents)}{state === "template" ? " a month" : ""}</>,
      usedBy: <>Scoreboard{pnlHref ? <> · <Link className="hover:underline" href={pnlHref}>P&L › {detail}</Link></> : null}</>,
      action: { label: "Edit", run: () => begin("amount") }, off: editOff,
    },
    {
      key: "counts", label: "Counts as",
      value: `${row.isAcquisitionCost ? "Acquisition" : "Overhead"} · ${row.acquisitionOverridden ? "your choice for this one" : `the default for ${detail}`}`,
      usedBy: "Cost per policy on the P&L", action: { label: "Edit", run: () => begin("counts") }, off: classifyOff,
    },
    {
      key: "detail", label: "Detail", value: detail,
      usedBy: <>P&L line · <Link className="hover:underline" href="/app/tax">the tax export</Link></>,
      action: { label: "Edit", run: () => begin("detail") }, off: editOff,
    },
    state === "template"
      ? { key: "repeats", label: "Repeats", value: `Every month since ${monthName(row.incurredOn)} · ${row.recurrenceEndOn ? `until ${shortDate(row.recurrenceEndOn)}` : "no end"}`, usedBy: "Comes back each month to OK", action: { label: "Edit", run: () => begin("repeats") }, off: readOnly ? READ_ONLY : undefined }
      : template
        ? { key: "repeats", label: "Repeats", value: <>Monthly · this is the {monthName(row.incurredOn)} copy</>, usedBy: "The monthly bill sets later months", action: { label: "Open the bill", href: template.href } }
        : { key: "repeats", label: "Repeats", value: "Once", usedBy: "—" },
    state === "waiting"
      ? { key: "paid", label: "Paid", value: "Not yet", usedBy: "Cash-basis P&L", action: { label: "OK it", run: () => setOking(true) }, off: readOnly ? READ_ONLY : undefined }
      : state === "unpaid"
        ? { key: "paid", label: "Paid", value: "Not yet", usedBy: "Cash-basis P&L", action: { label: "Mark paid", run: () => ask("paid", row) }, off: readOnly ? READ_ONLY : undefined }
        : state === "paid"
          ? { key: "paid", label: "Paid", value: [`${shortDate(row.paidOn!)}`, paidMethod && `by ${paidMethod.toLowerCase()}`, row.paymentReference && `ref ${row.paymentReference}`].filter(Boolean).join(" · "), usedBy: "Cash-basis P&L" }
          : state === "template"
            ? { key: "paid", label: "Paid", value: "Each month, when you OK it", usedBy: "Cash-basis P&L" }
            : { key: "paid", label: "Voided", value: row.voidReason ?? <span className="text-muted-foreground">—</span>, usedBy: "Reversed in the P&L" },
    {
      key: "note", label: "Note", value: row.description ? row.description : <span className="text-muted-foreground">—</span>, usedBy: "Only you see it",
      action: { label: row.description ? "Edit" : "Add", run: () => begin("note") }, off: editOff,
    },
  ];

  return (
    <>
      <TableCard footer={isMonthly(row) ? <span>Changing a monthly bill changes future months only; what is booked keeps its amount.</span> : undefined}>
        <table className="portal-lead-table w-full min-w-160 text-left text-sm">
          <thead><tr><th className="w-[200px]">Fact</th><th>Value</th><th>Used by</th><th className="text-right"><span className="sr-only">Change</span></th></tr></thead>
          <tbody>
            {facts.map((fact) => {
              const action = fact.action;
              const live = action && !fact.off;
              const run = live && "run" in action ? action.run : null;
              return (
                <tr key={fact.key} className={live ? "group cursor-pointer" : undefined} onClick={(ev) => { if ((ev.target as HTMLElement).closest("a, button")) return; if (run) run(); else if (live && "href" in action) router.push(action.href); }}>
                  <td className="whitespace-nowrap font-medium text-foreground">{fact.label}</td>
                  <td className="whitespace-nowrap">{fact.value}</td>
                  <td className="whitespace-nowrap">{fact.usedBy === "—" ? <span className="text-muted-foreground">—</span> : fact.usedBy}</td>
                  <td className="whitespace-nowrap text-right">
                    {!action ? null
                      : fact.off ? <span title={fact.off} className="cursor-not-allowed">{action.label}</span>
                      : "href" in action ? <Link href={action.href} className="group-hover:underline">{action.label} ›</Link>
                      : <button type="button" onClick={action.run} className="group-hover:underline">{action.label} ›</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>

      <FactDialog open={open === "amount"} onOpenChange={(o) => setOpen(o ? "amount" : null)} busy={busy} cancelLabel="Keep it" saveDisabled={Boolean(amountError)}
        title={`Change ${row.vendorName}'s amount?`}
        description={state === "template" ? "Future months only; what is already booked keeps its amount." : row.parentExpenseId ? `This month's copy only; the monthly bill keeps its amount.` : undefined}
        onSave={() => patch({ amount_cents: cents, ...(state === "template" ? { recurrence_end_on: end || null } : {}) })}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount ($)" htmlFor="fact-amount" error={amountError}><input id="fact-amount" className={control} inputMode="decimal" autoFocus value={amount} aria-invalid={amountError ? true : undefined} onChange={(ev) => setAmount(ev.target.value)} /></Field>
          {state === "template" ? <Field label="Ends" htmlFor="fact-end"><input id="fact-end" type="date" className={control} placeholder="No end" value={end} onChange={(ev) => setEnd(ev.target.value)} /></Field> : null}
        </div>
      </FactDialog>

      <FactDialog open={open === "counts"} onOpenChange={(o) => setOpen(o ? "counts" : null)} busy={busy} saveDisabled={acq === row.isAcquisitionCost}
        title={`${row.vendorName} · Counts as`}
        description={<>The default for {detail} is {fallback ? "Acquisition" : "Overhead"} (<Link className="text-[var(--accent-ink)] hover:underline" href="/app/accounting-settings">Settings › Accounting</Link>).</>}
        left={row.acquisitionOverridden ? <Button type="button" variant="ghost" disabled={busy} onClick={() => classify(fallback)}>Back to the default</Button> : undefined}
        onSave={() => classify(acq)}>
        <div role="radiogroup" aria-label="Counts as" className="flex flex-wrap gap-2">
          <ToggleChip role="radio" selected={acq} onClick={() => setAcq(true)}>Acquisition</ToggleChip>
          <ToggleChip role="radio" selected={!acq} onClick={() => setAcq(false)}>Overhead</ToggleChip>
        </div>
        <p className="m-0 text-xs text-muted-foreground">{ACQUISITION_CONSEQUENCE}</p>
      </FactDialog>

      <FactDialog open={open === "detail"} onOpenChange={(o) => setOpen(o ? "detail" : null)} busy={busy} saveDisabled={category === row.category}
        title={`${row.vendorName} · Detail`} description="Used by the P&L line and the tax export."
        onSave={() => patch({ category })}>
        <Field label="Detail" htmlFor="fact-category"><select id="fact-category" className={control} value={category} onChange={(ev) => setCategory(ev.target.value as ExpenseCategory)}>{categoriesIn(bucketOf(row.category)).map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}</select></Field>
      </FactDialog>

      <FactDialog open={open === "repeats"} onOpenChange={(o) => setOpen(o ? "repeats" : null)} busy={busy} saveDisabled={(end || null) === (row.recurrenceEndOn ?? null)}
        title={`When does ${row.vendorName} end?`} description="No copy comes back after this day. Empty: no end."
        onSave={() => patch({ recurrence_end_on: end || null })}>
        <Field label="Ends" htmlFor="fact-repeats-end"><input id="fact-repeats-end" type="date" className={control} value={end} onChange={(ev) => setEnd(ev.target.value)} /></Field>
      </FactDialog>

      <FactDialog open={open === "note"} onOpenChange={(o) => setOpen(o ? "note" : null)} busy={busy} saveDisabled={note.trim() === (row.description ?? "")}
        title={`${row.vendorName} · Note`} description="Only you see it."
        onSave={() => patch({ description: note.trim() || null }, "Saved")}>
        <Field label="Note" htmlFor="fact-note"><textarea id="fact-note" className={textareaControl} maxLength={500} autoFocus value={note} onChange={(ev) => setNote(ev.target.value)} /></Field>
      </FactDialog>

      {oking ? <OkDialog queue={[okItemOf(row)]} open onOpenChange={setOking} /> : null}
      {node}
    </>
  );
}
