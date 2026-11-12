"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { AccountingDialog } from "@/components/app/accounting/accounting-settings-rows";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { control, Field, textareaControl } from "@/components/ui/field";
import { Segmented } from "@/components/ui/view-tabs";
import { ACQUISITION_CONSEQUENCE, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/accounting/expensesCore";
import { percent } from "@/lib/accounting/producersCore";
import type { AccountingSettings } from "@/lib/accounting/settingsCore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Settings › Accounting, round 7 (board 7·2): one dialog per setting row. Each holds the explanation that used to
 * hide behind the (i), its control, an error line the owner can fix, and Cancel / Save. "Pay partners" (cadence and
 * draft days), "Below zero" (the share with its choice) and "Default split" (the % and Of) are one dialog each. The
 * nine expense categories are one lg dialog. Widening who sees tax IDs to bookkeepers asks first.
 */
export type Which =
  | "basis" | "fy" | "persist" | "sample"
  | "bankWindow" | "bankTol"
  | "invoiceTol" | "categories"
  | "autoPublish" | "cadence" | "footer" | "disputeTol"
  | "seeBalance" | "negative" | "split" | "shareFees"
  | "threshold" | "taxIds";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const BASIS_WORDS = { accrual: "It is earned (accrual)", cash: "It moves (cash)" } as const;
export const CADENCE_WORDS = { monthly: "Monthly", semi_monthly: "Twice a month", weekly: "Weekly" } as const;
export const NEGATIVE_WORDS = { carry_forward: "Carry it", cap: "Take a share each month", write_off: "Let it go" } as const;
export const SPLIT_OF_WORDS = { advance: "of the advance", earned: "of earned commission", both: "of both" } as const;
export const dollars = (cents: number) => formatCentsAsCurrency(cents);
const plain = (cents: number) => formatCentsAsCurrency(cents).replace(/[$,]/g, "");
const pctText = (bp: number) => percent(bp).replace("%", "");

const DOLLARS = "Enter an amount in dollars, like 50.00.";
const PERCENT = "Enter a percentage, like 50.";

/** A dollar amount typed in, as cents; null when it is not one. */
const centsOf = (text: string, max: number) => { const c = parseDollarsToCents(text); return c === null || c < 0 || c > max ? null : c; };
/** A percentage typed in ("50", "12.5"), as basis points; null when it is not one. */
const bpOf = (text: string) => { const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim()); if (!m) return null; const bp = Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2)); return bp > 10000 ? null : bp; };
/** A whole number within its range; null otherwise. */
const intOf = (text: string, min: number, max: number) => { if (!/^\d+$/.test(text.trim())) return null; const n = Number(text); return n < min || n > max ? null : n; };

/** An input with its unit beside it ("$ 50.00", "21 days after"). */
function Amount({ id, label, value, onChange, before, after, error, hint, numeric = "decimal" }: {
  id: string; label: string; value: string; onChange: (value: string) => void; before?: string; after?: string; error?: string | null; hint?: ReactNode; numeric?: "decimal" | "numeric";
}) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <span className="mt-1.5 flex items-center gap-2">
        {before && <span className="text-sm text-[var(--muted)]">{before}</span>}
        <input id={id} autoFocus inputMode={numeric} className={cn(control, "mt-0 w-36 tabular-nums", error && "border-[var(--error)]")} value={value} onChange={(e) => onChange(e.target.value)} />
        {after && <span className="text-sm text-[var(--muted)]">{after}</span>}
      </span>
    </Field>
  );
}

export function AccountingSettingDialog({ which, settings, canEdit, busy, onSave, onClose }: {
  which: Which;
  settings: AccountingSettings;
  canEdit: boolean;
  busy: boolean;
  /** True when it saved; the dialog then closes. */
  onSave: (patch: Partial<AccountingSettings>) => Promise<boolean>;
  onClose: () => void;
}) {
  const s = settings;
  const [d, setD] = useState<AccountingSettings>(settings);
  const set = <K extends keyof AccountingSettings>(k: K, v: AccountingSettings[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const [text, setText] = useState(() => ({
    bankTol: plain(s.bankAmountToleranceCents), invoiceTol: plain(s.invoiceToleranceCents), disputeTol: plain(s.payoutDisputeToleranceCents), threshold: plain(s.tax1099ThresholdCents),
    cap: pctText(s.producerRecoveryCapBp), split: s.producerDefaultSplitBp == null ? "" : pctText(s.producerDefaultSplitBp),
    draftDays: String(s.payoutDraftDays), bankWindow: String(s.bankWindowDays), sample: String(s.sampleThreshold),
  }));
  const typed = (k: keyof typeof text) => (v: string) => setText((cur) => ({ ...cur, [k]: v }));
  const [confirming, setConfirming] = useState(false);
  const submit = async (patch: Partial<AccountingSettings>) => { if (await onSave(patch)) onClose(); };

  const yesNo = (key: "producersSeeBalance" | "producerShareFees", label: string) => (
    <Segmented label={label} value={d[key] ? "yes" : "no"} onChange={(v) => set(key, v === "yes")} options={[{ key: "yes", label: "Yes" }, { key: "no", label: "No" }]} />
  );

  // Every dialog: its title, what it changes, the value for a read-only viewer, its controls, its first problem
  // (Save waits until it is fixed) and what it sends.
  type Spec = { title: string; said: ReactNode; size?: "md" | "lg"; read: ReactNode; body: ReactNode; problem?: string | null; patch: () => Partial<AccountingSettings> };
  const spec = ((): Spec => {
    switch (which) {
      case "basis": return {
        title: "Count money when", said: "Every P&L view, tax summary and producer statement opens on this.", read: BASIS_WORDS[s.defaultBasis],
        body: <>
          <Segmented label="P&L basis" value={d.defaultBasis} onChange={(v) => set("defaultBasis", v)} options={[{ key: "accrual", label: BASIS_WORDS.accrual }, { key: "cash", label: BASIS_WORDS.cash }]} />
          <p className="m-0 text-xs text-[var(--muted)]">Accrual books commission when the carrier reports it and costs when they are owed. Cash books both when money reaches or leaves the bank.</p>
        </>,
        patch: () => ({ defaultBasis: d.defaultBasis }),
      };
      case "fy": return {
        title: "Your financial year starts", said: "Year-to-date figures start here.", read: MONTHS[s.fyStartMonth - 1],
        body: <Field label="Month" htmlFor="acct-fy"><select id="acct-fy" autoFocus className={cn(control, "w-48")} value={d.fyStartMonth} onChange={(e) => set("fyStartMonth", Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>,
        patch: () => ({ fyStartMonth: d.fyStartMonth }),
      };
      case "persist": return {
        title: "Count a policy as persisting at month", said: "Cost per persisting policy on the P&L counts policies still in force at this month.", read: `Month ${s.persistencyMonth}`,
        body: <Segmented label="Persisting at month" value={String(d.persistencyMonth) as "3" | "6" | "9" | "13"} onChange={(v) => set("persistencyMonth", Number(v) as AccountingSettings["persistencyMonth"])} options={[3, 6, 9, 13].map((m) => ({ key: String(m) as "3" | "6" | "9" | "13", label: `Month ${m}` }))} />,
        patch: () => ({ persistencyMonth: d.persistencyMonth }),
      };
      case "sample": {
        const n = intOf(text.sample, 1, 1000);
        const problem = n === null ? "Enter 1 to 1,000 policies." : null;
        return {
          title: "Show counts instead of a rate below", said: "With fewer policies than this, cost per policy shows the two counts instead of a rate.", read: `${s.sampleThreshold} policies`,
          body: <Amount id="acct-sample" label="Fewer than" value={text.sample} onChange={typed("sample")} after="policies" numeric="numeric" error={problem} />,
          problem, patch: () => ({ sampleThreshold: n! }),
        };
      }
      case "bankWindow": {
        const n = intOf(text.bankWindow, 1, 120);
        const problem = n === null ? "Enter 1 to 120 days." : null;
        return {
          title: "Look for the deposit up to", said: "Days after the carrier's payment date. Past this with nothing in the bank, Bank deposits flags it as missing money, once your bank file reaches that date.", read: `${s.bankWindowDays} days after the carrier's date`,
          body: <Amount id="acct-bank-window" label="Look for up to" value={text.bankWindow} onChange={typed("bankWindow")} after="days after the carrier's date" numeric="numeric" error={problem} hint="1 to 120." />,
          problem, patch: () => ({ bankWindowDays: n! }),
        };
      }
      case "bankTol": {
        const c = centsOf(text.bankTol, 1_000_000);
        const problem = c === null ? DOLLARS : null;
        return {
          title: "Suggest a match when the amounts differ by up to", said: "A deposit this close to an expected payment is suggested as its match. $0.00 means the amounts must agree exactly.", read: dollars(s.bankAmountToleranceCents),
          body: <Amount id="acct-bank-tol" label="Up to" before="$" value={text.bankTol} onChange={typed("bankTol")} error={problem} />,
          problem, patch: () => ({ bankAmountToleranceCents: c! }),
        };
      }
      case "invoiceTol": {
        const c = centsOf(text.invoiceTol, 100_000_000);
        const problem = c === null ? DOLLARS : null;
        return {
          title: "Flag a bill that differs from your count by more than", said: "Bills outside this show as a difference on Vendor bills (Billed more than you got).", read: dollars(s.invoiceToleranceCents),
          body: <Amount id="acct-invoice-tol" label="More than" before="$" value={text.invoiceTol} onChange={typed("invoiceTol")} error={problem} />,
          problem, patch: () => ({ invoiceToleranceCents: c! }),
        };
      }
      case "categories": return {
        title: "Each expense category counts as", size: "lg",
        said: <>Applies to new expenses in that category. Ones already booked keep their choice; change those one by one on <Link className="underline" href="/app/expenses">Expenses</Link>.</>,
        read: <ul className="m-0 flex list-none flex-col gap-1 p-0">{EXPENSE_CATEGORIES.map((c) => <li key={c} className="flex justify-between gap-4"><span>{EXPENSE_CATEGORY_LABELS[c]}</span><span className="text-[var(--muted)]">{s.acquisitionDefaults[c] ? "Acquisition" : "Overhead"}</span></li>)}</ul>,
        body: <>
          <p className="m-0 text-sm text-[var(--ink)]">{ACQUISITION_CONSEQUENCE}</p>
          <ul className="m-0 flex list-none flex-col p-0">
            {EXPENSE_CATEGORIES.map((c) => (
              <li key={c} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-2 text-sm text-[var(--ink)] first:border-t-0">
                {EXPENSE_CATEGORY_LABELS[c]}
                <Segmented label={`${EXPENSE_CATEGORY_LABELS[c]}: acquisition or overhead`} value={d.acquisitionDefaults[c] ? "yes" : "no"} onChange={(v) => set("acquisitionDefaults", { ...d.acquisitionDefaults, [c]: v === "yes" })} options={[{ key: "yes", label: "Acquisition" }, { key: "no", label: "Overhead" }]} />
              </li>
            ))}
          </ul>
        </>,
        patch: () => ({ acquisitionDefaults: d.acquisitionDefaults }),
      };
      case "autoPublish": return {
        title: "When a payout run is ready", said: "A published run is visible to the partner at once. A wrong number they have already read is far harder to correct than one caught in draft.", read: s.payoutAutoPublish ? "Publish to the partner" : "Wait for my review",
        body: <Segmented label="When a payout run is ready" value={d.payoutAutoPublish ? "publish" : "wait"} onChange={(v) => set("payoutAutoPublish", v === "publish")} options={[{ key: "wait", label: "Wait for my review" }, { key: "publish", label: "Publish to the partner" }]} />,
        patch: () => ({ payoutAutoPublish: d.payoutAutoPublish }),
      };
      case "cadence": {
        const n = intOf(text.draftDays, 0, 28);
        const problem = n === null ? "Enter 0 to 28 days." : null;
        return {
          title: "Pay partners", said: "When the next draft run appears on Partner payouts.", read: `${CADENCE_WORDS[s.payoutCadence]} · draft ${s.payoutDraftDays} days after the period ends`,
          body: <>
            <Field label="How often"><div className="mt-1.5"><Segmented label="Payout cadence" value={d.payoutCadence} onChange={(v) => set("payoutCadence", v)} options={[{ key: "monthly", label: "Monthly" }, { key: "semi_monthly", label: "Twice a month" }, { key: "weekly", label: "Weekly" }]} /></div></Field>
            <Amount id="acct-draft-days" label="Draft the run" value={text.draftDays} onChange={typed("draftDays")} after="days after the period ends" numeric="numeric" error={problem} hint="0 to 28." />
          </>,
          problem, patch: () => ({ payoutCadence: d.payoutCadence, payoutDraftDays: n! }),
        };
      }
      case "footer": return {
        title: "Statement footer", said: "Printed at the foot of every statement a partner reads. Optional.", read: s.payoutStatementFooter || "None",
        body: <Field label="Footer" htmlFor="acct-footer" hint="Up to 1,000 characters."><textarea id="acct-footer" autoFocus className={textareaControl} maxLength={1000} placeholder="e.g. Questions? Reply to payouts@youragency.com" value={d.payoutStatementFooter ?? ""} onChange={(e) => set("payoutStatementFooter", e.target.value || null)} /></Field>,
        patch: () => ({ payoutStatementFooter: d.payoutStatementFooter?.trim() || null }),
      };
      case "disputeTol": {
        const c = centsOf(text.disputeTol, 100_000_000);
        const problem = c === null ? DOLLARS : null;
        return {
          title: "Ignore partner disputes under", said: "A disputed difference below this is accepted without review. $0.00 means every dispute is reviewed.", read: dollars(s.payoutDisputeToleranceCents),
          body: <Amount id="acct-dispute-tol" label="Under" before="$" value={text.disputeTol} onChange={typed("disputeTol")} error={problem} />,
          problem, patch: () => ({ payoutDisputeToleranceCents: c! }),
        };
      }
      case "seeBalance": return {
        title: "Producers see their own balance", said: "A producer sees what they are owed, chargebacks included, on My balance. A producer who finds a negative balance only when a payment does not arrive is the one who leaves.", read: s.producersSeeBalance ? "Yes" : "No",
        body: yesNo("producersSeeBalance", "Producers see their own balance"),
        patch: () => ({ producersSeeBalance: d.producersSeeBalance }),
      };
      case "negative": {
        const cap = d.producerNegativePolicy === "cap" ? bpOf(text.cap) : s.producerRecoveryCapBp;
        const problem = cap === null || cap < 1 ? PERCENT : null;
        return {
          title: "When someone's balance goes below zero", size: "lg",
          said: "The choice Run payroll starts with for anyone below zero; you can change it per person in the draft. Carry it: what they owe comes off their next pay in full. Take a share: that share of what they owe comes off each month. Let it go: the agency forgives it.",
          read: s.producerNegativePolicy === "cap" ? `Take ${percent(s.producerRecoveryCapBp)} of what they owe each month` : NEGATIVE_WORDS[s.producerNegativePolicy],
          body: <>
            <Segmented label="Negative balance" value={d.producerNegativePolicy} onChange={(v) => set("producerNegativePolicy", v)} options={[{ key: "carry_forward", label: "Carry it" }, { key: "cap", label: "Take a share each month" }, { key: "write_off", label: "Let it go" }]} />
            {d.producerNegativePolicy === "cap" && <Amount id="acct-cap" label="Take" value={text.cap} onChange={typed("cap")} after="% of what they owe each month" error={problem} />}
          </>,
          problem, patch: () => (d.producerNegativePolicy === "cap" ? { producerNegativePolicy: "cap", producerRecoveryCapBp: cap! } : { producerNegativePolicy: d.producerNegativePolicy }),
        };
      }
      case "split": {
        const split = text.split.trim() ? bpOf(text.split) : null;
        const problem = text.split.trim() && split === null ? PERCENT : null;
        return {
          title: "Default split for a new producer", said: "Filled in when you add a producer. Each producer's own split wins. Leave the share empty for none.",
          read: s.producerDefaultSplitBp == null ? "None" : `${percent(s.producerDefaultSplitBp)} ${SPLIT_OF_WORDS[s.producerDefaultBasis]}`,
          body: <>
            <Amount id="acct-split" label="Share" value={text.split} onChange={typed("split")} after="%" error={problem} hint="Empty for none." />
            <Field label="Of"><div className="mt-1.5"><Segmented label="Split of" value={d.producerDefaultBasis} onChange={(v) => set("producerDefaultBasis", v)} options={[{ key: "advance", label: "The advance" }, { key: "earned", label: "Earned commission" }, { key: "both", label: "Both" }]} /></div></Field>
          </>,
          problem, patch: () => ({ producerDefaultSplitBp: split, producerDefaultBasis: d.producerDefaultBasis }),
        };
      }
      case "shareFees": return {
        title: "Share carrier fees with producers", said: "A carrier fee on a policy is split with its producer the way the commission is.", read: s.producerShareFees ? "Yes" : "No",
        body: yesNo("producerShareFees", "Share carrier fees with producers"),
        patch: () => ({ producerShareFees: d.producerShareFees }),
      };
      case "threshold": {
        const c = centsOf(text.threshold, 100_000_000);
        const problem = c === null ? DOLLARS : null;
        return {
          title: "1099 threshold", said: "Payees paid this much or more in the year appear in the 1099 summary. Check the year's IRS figure; it moves.", read: dollars(s.tax1099ThresholdCents),
          body: <Amount id="acct-1099" label="Paid in the year" before="$" value={text.threshold} onChange={typed("threshold")} error={problem} />,
          problem, patch: () => ({ tax1099ThresholdCents: c! }),
        };
      }
      case "taxIds": return {
        title: "Who may see payee tax IDs", said: "Every reveal is recorded with who and when. The owner can always see them.", read: s.taxIdViewerRoles.includes("bookkeeper") ? "Owner and bookkeepers" : "Owner only",
        body: <Segmented label="Who may see payee tax IDs" value={d.taxIdViewerRoles.includes("bookkeeper") ? "both" : "owner"} onChange={(v) => set("taxIdViewerRoles", v === "both" ? ["owner", "bookkeeper"] : ["owner"])} options={[{ key: "owner", label: "Owner only" }, { key: "both", label: "Owner and bookkeepers" }]} />,
        patch: () => ({ taxIdViewerRoles: d.taxIdViewerRoles }),
      };
    }
  })();

  // Widening who sees tax IDs asks first (edit map 7: Confirm).
  const widens = which === "taxIds" && d.taxIdViewerRoles.includes("bookkeeper") && !s.taxIdViewerRoles.includes("bookkeeper");
  return (
    <>
      <AccountingDialog title={spec.title} said={spec.said} size={spec.size} canEdit={canEdit} readValue={spec.read} busy={busy} saveDisabled={Boolean(spec.problem)}
        onSave={() => { if (spec.problem) return; if (widens) { setConfirming(true); return; } void submit(spec.patch()); }} onClose={onClose}>
        {spec.body}
      </AccountingDialog>
      <ConfirmDialog open={confirming} onOpenChange={(open) => { setConfirming(open); if (!open) set("taxIdViewerRoles", ["owner"]); }} busy={busy} destructive={false}
        title="Let bookkeepers see tax IDs?" description="Bookkeepers can then reveal any payee's full tax ID. Every reveal is recorded with who and when."
        confirmLabel="Let them see" cancelLabel="Owner only"
        onConfirm={() => { setConfirming(false); void submit(spec.patch()); }} />
    </>
  );
}
