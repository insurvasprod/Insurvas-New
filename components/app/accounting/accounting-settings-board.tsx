"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { Advanced, FormSection, FormSections } from "@/components/app/settings/patterns";
import { DraftActions } from "@/components/app/settings/primitives";
import { LockedNote, SectionTabs, SettingRow, useAnchorTab } from "@/components/app/settings/setting-row";
import { inputControl, Switch } from "@/components/ui/field";
import { InfoTip } from "@/components/ui/info-tip";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { Segmented } from "@/components/ui/view-tabs";
import { ACQUISITION_CONSEQUENCE, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/accounting/expensesCore";
import { percent } from "@/lib/accounting/producersCore";
import type { AccountingSettings } from "@/lib/accounting/settingsCore";
import { TAX_NOTICE } from "@/lib/accounting/taxCore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * LA-7.9 · one place for everything LA-7 reads. It links to the screens that own commission
 * schedules, partner terms, carrier lags and vendors, and never edits them. Safety limits are shown
 * locked with their reason, beside the setting they guard. Every change is recorded with who, what,
 * from and to (the header's History).
 *
 * Money & compliance redesign A (owner pick 2026-11-03, docs/settings/MONEY-COMPLIANCE-SETTINGS.md):
 * the tabs sit on the title line and the first one, Start here, holds what decides the most. Every
 * setting says what it changes. Rarely changed values fold under Advanced. One save bar for the page.
 */
type Locked = { key: string; label: string; reason: string };
type Change = { field: string; from: unknown; to: unknown; at: string };
type Account = { id: string; nickname: string; lastFour: string | null; columnMap: { date: string; description: string; amount?: string | null; credit?: string | null; debit?: string | null } | null };
type Tab = "start" | "payouts" | "producers" | "bank";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const plain = (c: number) => formatCentsAsCurrency(c).replace(/[$,]/g, "");

const TABS: { key: Tab; label: string }[] = [
  { key: "start", label: "Start here" },
  { key: "payouts", label: "Partner payouts" },
  { key: "producers", label: "Producer pay" },
  { key: "bank", label: "Bills, bank & tax" },
];
/** Every anchor Settings search links to (#tax), and the tab that holds it. */
export const SECTION_TAB = {
  reporting: "start",
  "acquisition-or-overhead": "start",
  "partner-payouts": "payouts",
  "producer-splits": "producers",
  "vendor-bills": "bank",
  "bank-matching": "bank",
  tax: "bank",
} as const satisfies Record<string, Tab>;

/** Each safety limit (settingsCore LOCKED) said where it sits, beside the setting it guards; its reason is behind the (i). */
const LOCK_WORDS = {
  recurring_confirmation: "Recurring expenses always wait for you to confirm them before they book.",
  no_outbound_payments: "Insurvas never sends money. Runs are calculated and recorded; you pay the way you do today.",
  bank_auto_apply: "Matches are never applied for you. A person confirms each one.",
} as const;

const money = "w-36 tabular-nums";
const narrow = "w-28 tabular-nums";

export function AccountingSettingsBoard({ initial, locked, accounts, canEdit }: { initial: AccountingSettings; locked: readonly Locked[]; /** Still sent by the page; the header's History shows changes now. */ changes?: Change[]; accounts: Account[]; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("start");
  useAnchorTab(SECTION_TAB, setTab);
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const moneyOf = (from: AccountingSettings) => ({ tolerance: plain(from.invoiceToleranceCents), disputeTol: plain(from.payoutDisputeToleranceCents), bankTol: plain(from.bankAmountToleranceCents), threshold: plain(from.tax1099ThresholdCents), split: from.producerDefaultSplitBp == null ? "" : percent(from.producerDefaultSplitBp).replace("%", ""), cap: percent(from.producerRecoveryCapBp).replace("%", "") });
  const [text, setText] = useState(() => moneyOf(initial));
  const [errors, setErrors] = useState<Partial<Record<keyof ReturnType<typeof moneyOf>, string>>>({});
  const set = <K extends keyof AccountingSettings>(k: K, v: AccountingSettings[K]) => setS((cur) => ({ ...cur, [k]: v }));
  const bp = (value: string) => { const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim()); return m ? Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2)) : null; };
  const lock = (key: string) => locked.find((l) => l.key === key);

  /** True when it saved; the leave guard keeps the owner on the page otherwise. */
  const save = async (): Promise<boolean> => {
    const tolerance = parseDollarsToCents(text.tolerance), disputeTol = parseDollarsToCents(text.disputeTol), bankTol = parseDollarsToCents(text.bankTol), threshold = parseDollarsToCents(text.threshold);
    const split = text.split.trim() ? bp(text.split) : null, cap = bp(text.cap);
    const dollars = "Enter an amount in dollars, like 50.00.", pct = "Enter a percentage, like 50.";
    const found = {
      ...(tolerance === null && { tolerance: dollars }), ...(disputeTol === null && { disputeTol: dollars }), ...(bankTol === null && { bankTol: dollars }), ...(threshold === null && { threshold: dollars }),
      ...(cap === null && { cap: pct }), ...(text.split.trim() && split === null && { split: pct }),
    };
    setErrors(found);
    if (Object.keys(found).length) { notify.fail("Check the highlighted amounts."); return false; }
    const next = { ...s, invoiceToleranceCents: tolerance!, payoutDisputeToleranceCents: disputeTol!, bankAmountToleranceCents: bankTol!, tax1099ThresholdCents: threshold!, producerDefaultSplitBp: split, producerRecoveryCapBp: cap! };
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
      setText(moneyOf(json.settings));
      notify.done(json.changes.length ? `Saved ${json.changes.length} change${json.changes.length === 1 ? "" : "s"}. Recorded figures are unchanged.` : "Nothing changed");
      return true;
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const savedText = moneyOf(saved);
  const changedText = (Object.keys(savedText) as (keyof typeof savedText)[]).filter((k) => text[k] !== savedText[k]);
  const changedFields = (Object.keys(s) as (keyof AccountingSettings)[]).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(saved[k]));
  const pending = changedFields.length + changedText.length;
  const dirty = pending > 0;
  const dis = !canEdit;
  const discard = () => { setS(saved); setText(moneyOf(saved)); setErrors({}); };
  const amount = (key: keyof typeof text, cls: string, label: string, placeholder?: string) => (
    <>
      <input aria-label={label} className={cn(inputControl, cls, errors[key] && "border-[var(--error)]")} disabled={dis} inputMode="decimal" placeholder={placeholder} value={text[key]} onChange={(e) => { setText({ ...text, [key]: e.target.value }); setErrors({ ...errors, [key]: undefined }); }} />
      {errors[key] && <span role="alert" className="text-xs text-[var(--error-ink)]">{errors[key]}</span>}
    </>
  );
  const dollarField = (key: keyof typeof text, label: string) => <span className="flex items-center gap-2"><span className="text-sm text-[var(--muted)]">$</span>{amount(key, money, label)}</span>;
  const lockLine = (key: keyof typeof LOCK_WORDS) => { const l = lock(key); return l ? <LockedNote>{LOCK_WORDS[key]} <InfoTip label={`Why: ${l.label}`}>{l.reason}</InfoTip></LockedNote> : null; };
  const readOnlyValue = (value: string) => <p className="m-0 text-sm text-[var(--ink)]">{value}</p>;

  return (
    <div className="flex flex-col gap-6">
      <SectionTabs label="Accounting settings" tabs={TABS} value={tab} onChange={setTab}
        actions={canEdit ? <MoreMenu items={[{ label: "History", href: "/app/settings?history=accounting#settings-history" }, { label: "Expenses", href: "/app/expenses" }, { label: "Tax summaries", href: "/app/tax" }]} /> : <span className="text-sm text-[var(--muted)]">Only the owner changes these</span>} />
      <LeaveGuard dirty={dirty} onSave={save} onDiscard={discard} what="the accounting settings" />

      {tab === "start" && (
        <FormSections>
          <FormSection id="reporting" title="How your P&L counts money" info="The basis and year every P&L, tax and producer view opens on.">
            <SettingRow label="Count money when" sub="P&L basis" change="Accrual books commission when the carrier reports it and costs when they are owed. Cash books both when money reaches or leaves the bank. Every P&L view, tax summary and producer statement opens on this.">
              {dis ? readOnlyValue(s.defaultBasis === "cash" ? "It moves (cash)" : "It is earned (accrual)") : <Segmented label="P&L basis" value={s.defaultBasis} onChange={(v) => set("defaultBasis", v)} options={[{ key: "accrual", label: "It is earned (accrual)" }, { key: "cash", label: "It moves (cash)" }]} />}
            </SettingRow>
            <SettingRow label="Your financial year starts" change="Year-to-date figures start here.">
              <select aria-label="Financial year starts" className={cn(inputControl, "w-48")} disabled={dis} value={s.fyStartMonth} onChange={(e) => set("fyStartMonth", Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            </SettingRow>
            <Advanced summary="Advanced" hint={`Cost per persisting policy at month ${s.persistencyMonth} · counts below ${s.sampleThreshold} policies`}>
              <SettingRow label="Count a policy as persisting at month" change="Cost per persisting policy on the P&L counts policies still in force at this month.">
                <select aria-label="Persisting at month" className={cn(inputControl, "w-28")} disabled={dis} value={s.persistencyMonth} onChange={(e) => set("persistencyMonth", Number(e.target.value) as AccountingSettings["persistencyMonth"])}>{[3, 6, 9, 13].map((m) => <option key={m} value={m}>{m}</option>)}</select>
              </SettingRow>
              <SettingRow label="Show counts instead of a rate below" change="With fewer policies than this, cost per policy shows the two counts instead of a rate.">
                <span className="flex items-center gap-2"><input aria-label="Sample threshold" className={cn(inputControl, narrow)} disabled={dis} type="number" min={1} max={1000} value={s.sampleThreshold} onChange={(e) => set("sampleThreshold", Number(e.target.value) || 1)} /><span className="text-sm text-[var(--muted)]">policies</span></span>
              </SettingRow>
            </Advanced>
          </FormSection>

          <FormSection id="acquisition-or-overhead" title="Acquisition or overhead" info="Which expense categories count toward the cost of winning a policy.">
            <p className="m-0 text-sm font-medium text-[var(--ink)]">{ACQUISITION_CONSEQUENCE}</p>
            <div className="grid gap-x-8 gap-y-3 @3xl:grid-cols-2">
              {EXPENSE_CATEGORIES.map((c) => (
                <div key={c} className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ink)]">{EXPENSE_CATEGORY_LABELS[c]}
                  {dis
                    ? <span className="text-[var(--muted)]">{s.acquisitionDefaults[c] ? "Acquisition" : "Overhead"}</span>
                    : <Segmented label={`${EXPENSE_CATEGORY_LABELS[c]}: acquisition or overhead`} value={s.acquisitionDefaults[c] ? "yes" : "no"} onChange={(value) => set("acquisitionDefaults", { ...s.acquisitionDefaults, [c]: value === "yes" })} options={[{ key: "yes", label: "Acquisition" }, { key: "no", label: "Overhead" }]} />}
                </div>
              ))}
            </div>
            <p className="m-0 text-sm text-[var(--muted)]">Applies to new expenses in that category. Ones already booked keep their choice; change those one by one on <Link className="underline" href="/app/expenses">Expenses</Link>.</p>
            {lockLine("recurring_confirmation")}
          </FormSection>
        </FormSections>
      )}

      {tab === "payouts" && (
        <FormSections>
          <FormSection id="partner-payouts" title="Partner payouts" info="When Insurvas drafts what you owe each partner, and what the partner sees.">
            <SettingRow label="When a payout run is ready" change="A published run is visible to the partner at once. A wrong number they have already read is far harder to correct than one caught in draft.">
              {dis ? readOnlyValue(s.payoutAutoPublish ? "Publish to the partner" : "Wait for my review") : <Segmented label="When a payout run is ready" value={s.payoutAutoPublish ? "publish" : "wait"} onChange={(v) => set("payoutAutoPublish", v === "publish")} options={[{ key: "wait", label: "Wait for my review" }, { key: "publish", label: "Publish to the partner" }]} />}
            </SettingRow>
            <SettingRow label="Pay partners" change="When the next draft run appears on Partner payouts.">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                {dis ? readOnlyValue({ monthly: "Monthly", semi_monthly: "Twice a month", weekly: "Weekly" }[s.payoutCadence]) : <Segmented label="Payout cadence" value={s.payoutCadence} onChange={(v) => set("payoutCadence", v)} options={[{ key: "monthly", label: "Monthly" }, { key: "semi_monthly", label: "Twice a month" }, { key: "weekly", label: "Weekly" }]} />}
                <span className="flex items-center gap-2 text-sm text-[var(--body)]">Draft the run <input aria-label="Draft after (days)" className={cn(inputControl, "w-20 tabular-nums")} disabled={dis} type="number" min={0} max={28} value={s.payoutDraftDays} onChange={(e) => set("payoutDraftDays", Number(e.target.value) || 0)} /> days after the period ends</span>
              </div>
            </SettingRow>
            <SettingRow label="Statement footer" sub="Optional" change="Printed at the foot of every statement a partner reads.">
              <input aria-label="Statement footer" className={cn(inputControl, "max-w-[560px]")} disabled={dis} maxLength={1000} placeholder="e.g. Questions? Reply to payouts@youragency.com" value={s.payoutStatementFooter ?? ""} onChange={(e) => set("payoutStatementFooter", e.target.value || null)} />
            </SettingRow>
            <Advanced summary="Advanced" hint={`Ignore partner disputes under $${text.disputeTol}`}>
              <SettingRow label="Ignore partner disputes under" change="A disputed difference below this is accepted without review. $0.00 means every dispute is reviewed.">
                {dollarField("disputeTol", "Ignore partner disputes under")}
              </SettingRow>
            </Advanced>
            {lockLine("no_outbound_payments")}
            <p className="m-0 text-sm text-[var(--muted)]">Payout terms are kept on each <Link className="underline" href="/app/publishers">partner</Link>.</p>
          </FormSection>
        </FormSections>
      )}

      {tab === "producers" && (
        <FormSections>
          <FormSection id="producer-splits" title="Producer pay" info="How a producer's share is worked out, and what happens when chargebacks take it below zero.">
            <SettingRow label="Producers see their own balance" change="A producer sees what they are owed, chargebacks included, on My balance. A producer who finds a negative balance only when a payment does not arrive is the one who leaves.">
              <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label="Producers see their own balance" checked={s.producersSeeBalance} disabled={dis} onChange={(v) => set("producersSeeBalance", v)} />{s.producersSeeBalance ? "Yes" : "No"}</span>
            </SettingRow>
            <SettingRow label="When a producer's balance goes negative" change="Carry forward takes it from the next run in full. A capped share takes at most that share of each run. Write-off asks you for a reason each time.">
              {dis ? readOnlyValue({ carry_forward: "Carry it forward", cap: "Recover a capped share", write_off: "Write it off" }[s.producerNegativePolicy]) : <Segmented label="Negative balance" value={s.producerNegativePolicy} onChange={(v) => set("producerNegativePolicy", v)} options={[{ key: "carry_forward", label: "Carry it forward" }, { key: "cap", label: "Recover a capped share" }, { key: "write_off", label: "Write it off" }]} />}
              {s.producerNegativePolicy === "cap" && <span className="flex items-center gap-2 text-sm text-[var(--body)]">Recover at most {amount("cap", narrow, "Recover at most (%)")} % of each run</span>}
            </SettingRow>
            <SettingRow label="Default split for a new producer" sub="Leave empty for none" change="Filled in when you add a producer. Each producer's own split wins.">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <span className="flex items-center gap-2 text-sm text-[var(--muted)]">{amount("split", narrow, "Default split (%)", "None")} %</span>
                {dis ? readOnlyValue({ advance: "of the advance", earned: "of earned commission", both: "of both" }[s.producerDefaultBasis]) : <Segmented label="Split of" value={s.producerDefaultBasis} onChange={(v) => set("producerDefaultBasis", v)} options={[{ key: "advance", label: "Of the advance" }, { key: "earned", label: "Of earned commission" }, { key: "both", label: "Of both" }]} />}
              </div>
            </SettingRow>
            <Advanced summary="Advanced" hint={s.producerShareFees ? "Carrier fees are shared with producers" : "Carrier fees are not shared with producers"}>
              <SettingRow label="Share carrier fees with producers" change="A carrier fee on a policy is split with its producer the way the commission is.">
                <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label="Share carrier fees" checked={s.producerShareFees} disabled={dis} onChange={(v) => set("producerShareFees", v)} />{s.producerShareFees ? "Yes" : "No"}</span>
              </SettingRow>
            </Advanced>
            <p className="m-0 text-sm text-[var(--muted)]">Commission schedules and contract levels are on the <Link className="underline" href="/app/rate-card">Rate card</Link>.</p>
          </FormSection>
        </FormSections>
      )}

      {tab === "bank" && (
        <FormSections>
          <FormSection id="vendor-bills" title="Vendor bills" info="How far a lead vendor's bill may differ from what you recorded before Insurvas flags it.">
            <SettingRow label="Flag a bill that differs from what you recorded by more than" change="Bills outside this show as a difference on Lead invoices.">
              {dollarField("tolerance", "Invoice tolerance")}
            </SettingRow>
            <p className="m-0 text-sm text-[var(--muted)]">Vendors and campaigns are set on <Link className="underline" href="/app/campaigns">Campaigns</Link>.</p>
          </FormSection>

          <FormSection id="bank-matching" title="Bank accounts" info="The accounts you import statements from. Insurvas suggests which deposit pays which commission." aside={<Link className="text-sm font-semibold text-[var(--accent-ink)] hover:underline" href="/app/bank">Bank deposits</Link>}>
            {accounts.length === 0 ? <p className="m-0 text-sm text-[var(--muted)]">No accounts yet. Add one on <Link className="underline" href="/app/bank">Bank deposits</Link>.</p> : (
              <ul className="m-0 flex list-none flex-col p-0">
                {accounts.map((a) => (
                  <li key={a.id} className="border-t border-[var(--border)] first:border-t-0">
                    <Link href="/app/bank" className="flex items-center gap-4 py-3 text-sm text-[var(--ink)] no-underline hover:text-[var(--accent-ink)]">
                      <span className="min-w-40 font-medium">{a.nickname}{a.lastFour ? <span className="ml-2 tabular-nums text-[var(--muted)]">••{a.lastFour}</span> : null}</span>
                      <span className="flex-1 text-[var(--muted)]">{a.columnMap ? `Reads ${a.columnMap.date}, ${a.columnMap.description}, ${a.columnMap.amount ? a.columnMap.amount : `${a.columnMap.credit} / ${a.columnMap.debit}`}` : "Columns are set on the first import"}</span>
                      <ChevronRight aria-hidden="true" className="size-4 text-[var(--muted)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {lockLine("bank_auto_apply")}
            <Advanced summary="Advanced" hint={`Suggest matches within $${text.bankTol} · look back ${s.bankWindowDays} days`}>
              <SettingRow label="Suggest a match when the amounts differ by up to" change="A deposit this close to an expected payment is suggested as its match. $0.00 means the amounts must agree exactly.">
                {dollarField("bankTol", "Bank amount tolerance")}
              </SettingRow>
              <SettingRow label="Look back" change="How far before a deposit Insurvas looks for the payment it settles.">
                <span className="flex items-center gap-2"><input aria-label="Look back (days)" className={cn(inputControl, narrow)} disabled={dis} type="number" min={1} max={120} value={s.bankWindowDays} onChange={(e) => set("bankWindowDays", Number(e.target.value) || 1)} /><span className="text-sm text-[var(--muted)]">days</span></span>
              </SettingRow>
            </Advanced>
          </FormSection>

          <FormSection id="tax" title="Tax" info="The 1099 threshold and who may read payee tax IDs.">
            <SettingRow label="1099 threshold" sub="Check the year's IRS figure; it moves" change="Payees paid this much or more in the year appear in the 1099 summary.">
              {dollarField("threshold", "1099 threshold")}
            </SettingRow>
            <SettingRow label="Who may see payee tax IDs" change="Every reveal is recorded with who and when.">
              {dis ? readOnlyValue(s.taxIdViewerRoles.includes("bookkeeper") ? "The owner and bookkeepers" : "The owner only") : <Segmented label="Who may see payee tax IDs" value={s.taxIdViewerRoles.includes("bookkeeper") ? "both" : "owner"} onChange={(v) => set("taxIdViewerRoles", v === "both" ? ["owner", "bookkeeper"] : ["owner"])} options={[{ key: "owner", label: "Owner only" }, { key: "both", label: "Owner and bookkeepers" }]} />}
            </SettingRow>
            <p className="m-0 text-xs text-[var(--muted)]">{TAX_NOTICE} This notice is shown on every tax screen and export, and cannot be edited.</p>
            <p className="m-0 text-sm text-[var(--muted)]">Tax categories are mapped on <Link className="underline" href="/app/tax">Tax summaries</Link>.</p>
          </FormSection>
        </FormSections>
      )}

      <SettingsSaveBar visible={canEdit && dirty} note={`${pending} unsaved change${pending === 1 ? "" : "s"} to the accounting settings`}>
        <DraftActions dirty={dirty} saving={busy} onDiscard={discard} onSave={() => void save()} />
      </SettingsSaveBar>
    </div>
  );
}
