"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { TableCard } from "@/components/ui/table-card";
import { ACQUISITION_CONSEQUENCE, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/accounting/expensesCore";
import { NEGATIVE_POLICY_LABELS, percent } from "@/lib/accounting/producersCore";
import type { AccountingSettings } from "@/lib/accounting/settingsCore";
import { TAX_NOTICE } from "@/lib/accounting/taxCore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.9 · one place for everything LA-7 reads. It links to the screens that own commission
 * schedules, partner terms, carrier lags and vendors, and never edits them. Safety limits are shown
 * locked with their reason. Every change is recorded with who, what, from and to.
 */
type Locked = { key: string; label: string; reason: string };
type Change = { field: string; from: unknown; to: unknown; at: string };
type Account = { id: string; nickname: string; lastFour: string | null; columnMap: { date: string; description: string; amount?: string | null; credit?: string | null; debit?: string | null } | null };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const plain = (c: number) => formatCentsAsCurrency(c).replace(/[$,]/g, "");

export function AccountingSettingsBoard({ initial, locked, changes, accounts, canEdit }: { initial: AccountingSettings; locked: readonly Locked[]; changes: Change[]; accounts: Account[]; canEdit: boolean }) {
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [money, setMoney] = useState({ tolerance: plain(initial.invoiceToleranceCents), disputeTol: plain(initial.payoutDisputeToleranceCents), bankTol: plain(initial.bankAmountToleranceCents), threshold: plain(initial.tax1099ThresholdCents), split: initial.producerDefaultSplitBp == null ? "" : percent(initial.producerDefaultSplitBp).replace("%", ""), cap: percent(initial.producerRecoveryCapBp).replace("%", "") });
  const set = <K extends keyof AccountingSettings>(k: K, v: AccountingSettings[K]) => setS((cur) => ({ ...cur, [k]: v }));
  const bp = (text: string) => { const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim()); return m ? Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2)) : null; };

  const save = async () => {
    const tolerance = parseDollarsToCents(money.tolerance), disputeTol = parseDollarsToCents(money.disputeTol), bankTol = parseDollarsToCents(money.bankTol), threshold = parseDollarsToCents(money.threshold);
    const split = money.split.trim() ? bp(money.split) : null, cap = bp(money.cap);
    if (tolerance === null || disputeTol === null || bankTol === null || threshold === null || cap === null || (money.split.trim() && split === null)) { notify.fail("Check the amounts and percentages."); return; }
    const next = { ...s, invoiceToleranceCents: tolerance, payoutDisputeToleranceCents: disputeTol, bankAmountToleranceCents: bankTol, tax1099ThresholdCents: threshold, producerDefaultSplitBp: split, producerRecoveryCapBp: cap };
    const body = {
      default_basis: next.defaultBasis, fy_start_month: next.fyStartMonth, persistency_month: next.persistencyMonth, sample_threshold: next.sampleThreshold, acquisition_defaults: next.acquisitionDefaults,
      invoice_tolerance_cents: next.invoiceToleranceCents, payout_cadence: next.payoutCadence, payout_draft_days: next.payoutDraftDays, payout_auto_publish: next.payoutAutoPublish, payout_dispute_tolerance_cents: next.payoutDisputeToleranceCents,
      payout_statement_footer: next.payoutStatementFooter, producer_default_split_bp: next.producerDefaultSplitBp, producer_default_basis: next.producerDefaultBasis,
      producer_negative_policy: next.producerNegativePolicy, producer_recovery_cap_bp: next.producerRecoveryCapBp, producers_see_balance: next.producersSeeBalance, producer_share_fees: next.producerShareFees,
      bank_amount_tolerance_cents: next.bankAmountToleranceCents, bank_window_days: next.bankWindowDays, tax_1099_threshold_cents: next.tax1099ThresholdCents, tax_id_viewer_roles: next.taxIdViewerRoles,
    };
    setBusy(true);
    try {
      const res = await fetch("/api/app/accounting/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "That didn't save");
      setS(json.settings);
      setSaved(json.settings);
      notify.done(json.changes.length ? `Saved ${json.changes.length} change${json.changes.length === 1 ? "" : "s"} — recorded figures are unchanged` : "Nothing changed");
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };

  const dirty = JSON.stringify(s) !== JSON.stringify(saved) || money.tolerance !== plain(saved.invoiceToleranceCents) || money.disputeTol !== plain(saved.payoutDisputeToleranceCents) || money.bankTol !== plain(saved.bankAmountToleranceCents) || money.threshold !== plain(saved.tax1099ThresholdCents);
  const field = "flex flex-col gap-1 text-sm";
  // Each section carries an id, so Settings search (LA-8.1) can land on it: "partner-payouts".
  const section = (title: string, children: ReactNode, note?: ReactNode, id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) => (
    <TableCard>
      <div id={id} className="flex scroll-mt-24 flex-col gap-4 p-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {children}
        {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
      </div>
    </TableCard>
  );
  const dis = !canEdit;

  return (
    <div className="flex flex-col gap-6">
      {!canEdit ? <p className="text-sm text-muted-foreground">Only the owner can change these.</p> : null}
      {section("Reporting", (
        <div className="grid gap-3 sm:grid-cols-4">
          <label className={field}>P&L basis<select className={toolbarControl} disabled={dis} value={s.defaultBasis} onChange={(e) => set("defaultBasis", e.target.value as "accrual" | "cash")}><option value="accrual">Accrual</option><option value="cash">Cash</option></select></label>
          <label className={field}>Financial year starts<select className={toolbarControl} disabled={dis} value={s.fyStartMonth} onChange={(e) => set("fyStartMonth", Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <label className={field}>Persisting at month<select className={toolbarControl} disabled={dis} value={s.persistencyMonth} onChange={(e) => set("persistencyMonth", Number(e.target.value) as AccountingSettings["persistencyMonth"])}>{[3, 6, 9, 13].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label className={field}>Show counts below<input className={toolbarControl} disabled={dis} type="number" min={1} max={1000} value={s.sampleThreshold} onChange={(e) => set("sampleThreshold", Number(e.target.value) || 1)} /></label>
        </div>
      ), "Below the sample size, cost per policy shows the two counts instead of a rate.")}

      {section("Acquisition or overhead, by expense category", (
        <div className="grid gap-2 sm:grid-cols-2">
          {EXPENSE_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center justify-between gap-3 text-sm">{EXPENSE_CATEGORY_LABELS[c]}
              <select className={toolbarControl} disabled={dis} value={s.acquisitionDefaults[c] ? "yes" : "no"} onChange={(e) => set("acquisitionDefaults", { ...s.acquisitionDefaults, [c]: e.target.value === "yes" })}><option value="yes">Acquisition</option><option value="no">Overhead</option></select>
            </label>
          ))}
        </div>
      ), <><strong>{ACQUISITION_CONSEQUENCE}</strong> A change applies to new expenses; ones already booked keep their choice (change those one by one on <Link className="underline" href="/app/expenses">Expenses</Link>).</>, "acquisition-or-overhead")}

      {section("Partner payouts", (
        <div className="grid gap-3 sm:grid-cols-4">
          <label className={field}>Run cadence<select className={toolbarControl} disabled={dis} value={s.payoutCadence} onChange={(e) => set("payoutCadence", e.target.value as AccountingSettings["payoutCadence"])}><option value="monthly">Monthly</option><option value="semi_monthly">Twice a month</option><option value="weekly">Weekly</option></select></label>
          <label className={field}>Draft after (days)<input className={toolbarControl} disabled={dis} type="number" min={0} max={28} value={s.payoutDraftDays} onChange={(e) => set("payoutDraftDays", Number(e.target.value) || 0)} /></label>
          <label className={field}>A new run<select className={toolbarControl} disabled={dis} value={s.payoutAutoPublish ? "publish" : "wait"} onChange={(e) => set("payoutAutoPublish", e.target.value === "publish")}><option value="wait">Waits for review</option><option value="publish">Publishes itself</option></select></label>
          <label className={field}>Flag invoices off by more than ($)<input className={toolbarControl} disabled={dis} inputMode="decimal" value={money.tolerance} onChange={(e) => setMoney({ ...money, tolerance: e.target.value })} /></label>
          <label className={field}>Ignore partner disputes under ($)<input className={toolbarControl} disabled={dis} inputMode="decimal" value={money.disputeTol} onChange={(e) => setMoney({ ...money, disputeTol: e.target.value })} /></label>
          <label className={`${field} sm:col-span-4`}>Statement footer<input className={toolbarControl} disabled={dis} maxLength={1000} value={s.payoutStatementFooter ?? ""} onChange={(e) => set("payoutStatementFooter", e.target.value || null)} /></label>
        </div>
      ), <>A published run is visible to the partner — a wrong number they have already read is far harder to correct than one caught in draft. Payout terms are kept on each <Link className="underline" href="/app/publishers">partner</Link>.</>)}

      {section("Producer splits", (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={field}>Default split for a new producer (%)<input className={toolbarControl} disabled={dis} inputMode="decimal" placeholder="None" value={money.split} onChange={(e) => setMoney({ ...money, split: e.target.value })} /></label>
          <label className={field}>Of<select className={toolbarControl} disabled={dis} value={s.producerDefaultBasis} onChange={(e) => set("producerDefaultBasis", e.target.value as AccountingSettings["producerDefaultBasis"])}><option value="advance">The advance</option><option value="earned">Earned commission</option><option value="both">Both</option></select></label>
          <label className={field}>Carrier fees shared<select className={toolbarControl} disabled={dis} value={s.producerShareFees ? "yes" : "no"} onChange={(e) => set("producerShareFees", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
          <label className={`${field} sm:col-span-2`}>A negative balance<select className={toolbarControl} disabled={dis} value={s.producerNegativePolicy} onChange={(e) => set("producerNegativePolicy", e.target.value as AccountingSettings["producerNegativePolicy"])}>{(Object.keys(NEGATIVE_POLICY_LABELS) as (keyof typeof NEGATIVE_POLICY_LABELS)[]).map((k) => <option key={k} value={k}>{NEGATIVE_POLICY_LABELS[k]}</option>)}</select></label>
          <label className={field}>Recover at most (%)<input className={toolbarControl} disabled={dis || s.producerNegativePolicy !== "cap"} inputMode="decimal" value={money.cap} onChange={(e) => setMoney({ ...money, cap: e.target.value })} /></label>
          <label className={`${field} sm:col-span-3`}>Producers see their own balance<select className={toolbarControl} disabled={dis} value={s.producersSeeBalance ? "yes" : "no"} onChange={(e) => set("producersSeeBalance", e.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></label>
        </div>
      ), "A producer who discovers a negative balance when a cheque fails to arrive is a producer who leaves; the chargebacks were real — the surprise is the avoidable part.")}

      {section("Bank matching", (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={field}>Amount tolerance ($)<input className={toolbarControl} disabled={dis} inputMode="decimal" value={money.bankTol} onChange={(e) => setMoney({ ...money, bankTol: e.target.value })} /></label>
            <label className={field}>Look back (days)<input className={toolbarControl} disabled={dis} type="number" min={1} max={120} value={s.bankWindowDays} onChange={(e) => set("bankWindowDays", Number(e.target.value) || 1)} /></label>
          </div>
          <ul className="text-sm">{accounts.length === 0 ? <li className="text-muted-foreground">No accounts yet — add one on <Link className="underline" href="/app/bank">Bank deposits</Link>.</li> : accounts.map((a) => <li key={a.id}>{a.nickname}{a.lastFour ? ` ••${a.lastFour}` : ""} — {a.columnMap ? `date “${a.columnMap.date}”, description “${a.columnMap.description}”, ${a.columnMap.amount ? `amount “${a.columnMap.amount}”` : `in/out “${a.columnMap.credit}”/“${a.columnMap.debit}”`}` : "mapping set on the first import"}</li>)}</ul>
        </>
      ), <>Insurvas keeps each carrier&apos;s expected payment lag.</>)}

      {section("Tax", (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={field}>1099 threshold ($)<input className={toolbarControl} disabled={dis} inputMode="decimal" value={money.threshold} onChange={(e) => setMoney({ ...money, threshold: e.target.value })} /></label>
          <label className={`${field} sm:col-span-2`}>Who may see payee tax IDs<select className={toolbarControl} disabled={dis} value={s.taxIdViewerRoles.includes("bookkeeper") ? "both" : "owner"} onChange={(e) => set("taxIdViewerRoles", e.target.value === "both" ? ["owner", "bookkeeper"] : ["owner"])}><option value="owner">The owner only</option><option value="both">The owner and bookkeepers</option></select></label>
          <p className="text-sm sm:col-span-3"><span className="text-xs font-semibold uppercase text-muted-foreground">Notice on every tax screen (not editable): </span>{TAX_NOTICE}</p>
        </div>
      ), <>The threshold moves — check the year&apos;s IRS instructions. Categories are set on <Link className="underline" href="/app/tax">Tax summaries</Link>.</>)}

      {section("Locked", (
        <ul className="flex flex-col gap-2 text-sm">{locked.map((l) => <li key={l.key}><span aria-hidden>🔒 </span><strong>{l.label}.</strong> <span className="text-muted-foreground">{l.reason}</span></li>)}</ul>
      ), <>Set elsewhere and linked, never edited here: commission schedules and contract levels (<Link className="underline" href="/app/rate-card">Rate card</Link>), partner terms, carrier lags, vendors and campaigns (<Link className="underline" href="/app/campaigns">Campaigns</Link>).</>)}

      {changes.length ? section("Recent changes", (
        <ul className="text-sm">{changes.map((c, i) => <li key={i}>{c.at.slice(0, 16).replace("T", " ")} — {c.field.replace(/_/g, " ")}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}</li>)}</ul>
      )) : null}

      {canEdit ? <div className="sticky bottom-0 flex justify-end bg-[var(--canvas)] py-3"><Button disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</Button></div> : null}
    </div>
  );
}
