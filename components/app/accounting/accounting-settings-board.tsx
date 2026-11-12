"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";

import { AccountingSettingDialog, BASIS_WORDS, CADENCE_WORDS, dollars, MONTHS, SPLIT_OF_WORDS, type Which } from "@/components/app/accounting/accounting-settings-dialogs";
import { GroupLine, LockLine, PageLine, SettingHead, SettingLine, useAccountingSave } from "@/components/app/accounting/accounting-settings-rows";
import { SectionTabs, useAnchorTab } from "@/components/app/settings/setting-row";
import { MoreMenu } from "@/components/ui/more-menu";
import { TableCard } from "@/components/ui/table-card";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/accounting/expensesCore";
import { percent } from "@/lib/accounting/producersCore";
import { ACCOUNTING_DEFAULTS, COLUMNS, type AccountingSettings } from "@/lib/accounting/settingsCore";
import { TAX_NOTICE } from "@/lib/accounting/taxCore";

/**
 * LA-7.9 · one place for everything LA-7 reads. It links to the screens that own commission schedules, partner
 * terms, carrier lags and vendors, and never edits them. Safety limits are rows that never open, their reason behind
 * the (i). Every change is recorded with who, what, from and to (More › History).
 *
 * Round 7 (owner pick 7·A "A tab per page, rows open a dialog", 2026-11-10; docs/la4/mockups-r7/accounting.html §7):
 * six tabs on the title line, one per Accounting page that has settings, held in the address (?tab=bank). Each tab
 * is a table: Setting · Now (the value in words) · Used by (linked) · Changed · Edit ›. A row opens its dialog, which
 * saves that setting on its own, so there is no page-wide save bar or leave guard. Read-only: the rows read the same,
 * the last column says only the owner changes these, and a dialog shows the value with Close only.
 */
type Locked = { key: string; label: string; reason: string };
/** One recorded change (accounting_setting_change), newest first; `name` is the person who made it, when known. */
type Change = { field: string; from?: unknown; to?: unknown; by?: string; at: string; name?: string | null };
type Account = { id: string; nickname: string; lastFour: string | null; columnMap?: unknown };
export type Tab = "books" | "bank" | "bills" | "payouts" | "producers" | "tax";
export const TAB_KEYS: readonly Tab[] = ["books", "bank", "bills", "payouts", "producers", "tax"];

const TABS: { key: Tab; label: string }[] = [
  { key: "books", label: "Books" },
  { key: "bank", label: "Bank" },
  { key: "bills", label: "Bills & expenses" },
  { key: "payouts", label: "Partner payouts" },
  { key: "producers", label: "Producer pay" },
  { key: "tax", label: "Tax" },
];
/** Every anchor Settings search links to (#tax), and the tab that holds it. */
export const SECTION_TAB = {
  reporting: "books",
  "acquisition-or-overhead": "bills",
  "partner-payouts": "payouts",
  "producer-splits": "producers",
  "vendor-bills": "bills",
  "bank-matching": "bank",
  tax: "tax",
} as const satisfies Record<string, Tab>;

const HISTORY = "/app/settings?history=accounting#settings-history";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const day = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
/** "Rinor Gllareva" as "Rinor G.". */
const shortName = (name: string) => { const [first, ...rest] = name.trim().split(/\s+/); const last = rest.pop(); return last ? `${first} ${last[0]}.` : first; };
/** A link in a cell: the normal colour, underlined on hover (owner 2026-11-11, one colour per table). */
const A = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className="text-foreground hover:underline">{children}</Link>;

export function AccountingSettingsBoard({ initial, locked, changes = [], accounts, canEdit, canSeeHistory = canEdit, initialTab = "books" }: {
  initial: AccountingSettings;
  locked: readonly Locked[];
  changes?: Change[];
  accounts: Account[];
  canEdit: boolean;
  /** The owner: More › History. */
  canSeeHistory?: boolean;
  initialTab?: Tab;
}) {
  const [tab, setTabState] = useState<Tab>(initialTab);
  // The tab is kept in the address (?tab=), without a round trip to the server.
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    try { window.history.replaceState(window.history.state, "", `${window.location.pathname}?tab=${next}${window.location.hash}`); } catch { /* the tab still shows */ }
  }, []);
  useAnchorTab(SECTION_TAB, setTab);
  const [s, setS] = useState(initial);
  const [open, setOpen] = useState<Which | null>(null);
  const { busy, save } = useAccountingSave(s, setS);
  const lock = (key: string) => locked.find((l) => l.key === key);

  /** Who changed the row last and when, if the record has it; else whose the value is. */
  const changed = (keys: (keyof AccountingSettings)[]) => {
    const columns = keys.map((k) => COLUMNS[k]);
    const last = changes.find((c) => columns.includes(c.field));
    if (last) return `${last.name ? shortName(last.name) : "yours"} · ${day(last.at)}`;
    return keys.some((k) => !same(s[k], ACCOUNTING_DEFAULTS[k])) ? "yours" : "Insurvas's";
  };
  /** What every setting row takes besides its words. */
  const line = (which: Which, keys: (keyof AccountingSettings)[]) => ({ changed: changed(keys), canEdit, onOpen: () => setOpen(which) });
  const row = (which: Which, keys: (keyof AccountingSettings)[], label: string, now: ReactNode, usedBy: ReactNode) => (
    <SettingLine key={which} label={label} now={now} usedBy={usedBy} {...line(which, keys)} />
  );
  const lockRow = (key: string, label: string, now: string, extra?: ReactNode) => {
    const l = lock(key);
    return l ? <LockLine label={label} now={now} why={`Why: ${label}`} reason={<>{extra}{l.reason}</>} /> : null;
  };
  const foot = (left: ReactNode) => (
    <>
      <span>{left}</span>
      {canSeeHistory && <Link className="font-medium hover:underline" href={HISTORY}>History of these settings ›</Link>}
    </>
  );
  const table = "portal-lead-table w-full text-left text-sm";
  const acquisition = EXPENSE_CATEGORIES.filter((c) => s.acquisitionDefaults[c]);
  const overhead = EXPENSE_CATEGORIES.filter((c) => !s.acquisitionDefaults[c]);
  const categoryNames = (list: readonly (typeof EXPENSE_CATEGORIES)[number][]) => list.map((c) => EXPENSE_CATEGORY_LABELS[c]).join(" · ");
  /** Up to three categories by name, else how many: one line; the full list is the tooltip. */
  const categoryCount = (list: readonly (typeof EXPENSE_CATEGORIES)[number][]) => (list.length <= 3 ? categoryNames(list) : `${list.length} categories`);

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-4">
      <SectionTabs label="Accounting settings" tabs={TABS} value={tab} onChange={setTab}
        actions={canSeeHistory ? <MoreMenu items={[{ label: "History", href: HISTORY }]} /> : undefined} />

      {tab === "books" && (
        <TableCard footer={foot("Changes apply from now on. Recorded figures are unchanged.")}>
          <table className={table} data-even="off">
            <SettingHead />
            <tbody>
              <SettingLine id="reporting" label="Count money when" now={BASIS_WORDS[s.defaultBasis]} usedBy={<span title="Producer statements open on it too"><A href="/app/pnl">Profit &amp; loss</A> · <A href="/app/tax">Tax summaries</A></span>} {...line("basis", ["defaultBasis"])} />
              {row("fy", ["fyStartMonth"], "Your financial year starts", MONTHS[s.fyStartMonth - 1], "Year-to-date figures")}
              {row("persist", ["persistencyMonth"], "Count a policy as persisting at month", String(s.persistencyMonth), <A href="/app/pnl">Profit &amp; loss › Persisting cost</A>)}
              {row("sample", ["sampleThreshold"], "Show counts instead of a rate below", plural(s.sampleThreshold, "policy", "policies"), "Cost per policy on the P&L")}
            </tbody>
          </table>
        </TableCard>
      )}

      {tab === "bank" && (
        <TableCard footer={foot("Changes apply from now on. Recorded figures are unchanged.")}>
          <table className={table} data-even="off">
            <SettingHead />
            <tbody id="bank-matching" className="scroll-mt-24">
              {row("bankWindow", ["bankWindowDays"], "Look for the deposit up to", `${plural(s.bankWindowDays, "day")} after the carrier's date`, <span title="Missing money"><A href="/app/bank">Bank deposits › Payments</A></span>)}
              {row("bankTol", ["bankAmountToleranceCents"], "Suggest a match when the amounts differ by up to", s.bankAmountToleranceCents === 0 ? <span title="Amounts must agree">$0.00</span> : dollars(s.bankAmountToleranceCents), "Deposits › suggestions")}
              <PageLine label="Bank accounts" href="/app/bank?view=accounts" usedBy={<A href="/app/bank?view=accounts">Bank deposits › Accounts</A>}
                now={accounts.length ? <span title={accounts.map((a) => `${a.nickname}${a.lastFour ? ` ••${a.lastFour}` : ""}`).join(", ")}>{accounts.length === 1 ? `${accounts[0].nickname}${accounts[0].lastFour ? ` ••${accounts[0].lastFour}` : ""}` : plural(accounts.length, "account")}</span> : "None yet"} />
              {lockRow("bank_auto_apply", "Matches are never applied for you", "A person confirms each one")}
            </tbody>
          </table>
        </TableCard>
      )}

      {tab === "bills" && (
        <TableCard footer={foot(<>Vendors and campaigns are set on <Link className="underline" href="/app/campaigns">Campaigns</Link>.</>)}>
          <table className={table} data-even="off">
            <SettingHead />
            <tbody>
              <SettingLine id="vendor-bills" label="Flag a bill that differs from your count by more than" now={dollars(s.invoiceToleranceCents)} usedBy={<span title="Billed more than you got"><A href="/app/invoices">Vendor bills</A></span>} {...line("invoiceTol", ["invoiceToleranceCents"])} />
            </tbody>
            <tbody id="acquisition-or-overhead" className="scroll-mt-24">
              <GroupLine>Each expense category counts as</GroupLine>
              {acquisition.length > 0 && <SettingLine label={<span title={categoryNames(acquisition)}>{categoryCount(acquisition)}</span>} now="Acquisition" usedBy="Cost per policy" changed={changed(["acquisitionDefaults"])} canEdit={canEdit} onOpen={() => setOpen("categories")} />}
              {overhead.length > 0 && <SettingLine label={<span title={categoryNames(overhead)}>{categoryCount(overhead)}</span>} now="Overhead" usedBy="Net profit only" changed={changed(["acquisitionDefaults"])} canEdit={canEdit} onOpen={() => setOpen("categories")} />}
              {lockRow("recurring_confirmation", "Monthly bills wait for your OK", "Always, before they book")}
            </tbody>
          </table>
        </TableCard>
      )}

      {tab === "payouts" && (
        <TableCard footer={foot(<>Payout terms are kept on each partner. <Link className="underline" href="/app/publishers">Partners ›</Link></>)}>
          <table className={table} data-even="off">
            <SettingHead />
            <tbody>
              <SettingLine id="partner-payouts" label="When a payout run is ready" now={s.payoutAutoPublish ? "Publish to the partner" : "Wait for my review"} usedBy={<A href="/app/payouts">Partner payouts</A>} {...line("autoPublish", ["payoutAutoPublish"])} />
              {row("cadence", ["payoutCadence", "payoutDraftDays"], "Pay partners", `${CADENCE_WORDS[s.payoutCadence]} · draft ${plural(s.payoutDraftDays, "day")} after the period ends`, "The next draft run")}
              {row("footer", ["payoutStatementFooter"], "Statement footer", s.payoutStatementFooter ? <span title={s.payoutStatementFooter}>{s.payoutStatementFooter.length > 48 ? "Set" : s.payoutStatementFooter}</span> : "None", "Every partner statement")}
              {row("disputeTol", ["payoutDisputeToleranceCents"], "Ignore partner disputes under", s.payoutDisputeToleranceCents === 0 ? <span title="Every dispute is reviewed">$0.00</span> : dollars(s.payoutDisputeToleranceCents), "Disputes on a run")}
              {lockRow("no_outbound_payments", "Insurvas never sends money", "Runs are calculated and recorded")}
            </tbody>
          </table>
        </TableCard>
      )}

      {tab === "producers" && (
        <TableCard footer={foot(<>Commission schedules and contract levels are on the <Link className="underline" href="/app/rate-card">Rate card</Link>.</>)}>
          <table className={table} data-even="off">
            <SettingHead />
            <tbody>
              <SettingLine id="producer-splits" label="Producers see their own balance" now={s.producersSeeBalance ? "Yes" : "No"} usedBy={<A href="/app/my-balance">My balance</A>} {...line("seeBalance", ["producersSeeBalance"])} />
              {row("negative", ["producerNegativePolicy", "producerRecoveryCapBp"], "When someone's balance goes below zero",
                s.producerNegativePolicy === "carry_forward" ? "Carry it to their next pay" : s.producerNegativePolicy === "cap" ? `Take ${percent(s.producerRecoveryCapBp)} of what they owe each month` : "Let it go",
                <>Run payroll · <A href="/app/producer-splits">Producer splits</A></>)}
              {row("split", ["producerDefaultSplitBp", "producerDefaultBasis"], "Default split for a new producer", s.producerDefaultSplitBp == null ? "None" : `${percent(s.producerDefaultSplitBp)} ${SPLIT_OF_WORDS[s.producerDefaultBasis]}`, "Adding a producer")}
              {row("shareFees", ["producerShareFees"], "Share carrier fees with producers", s.producerShareFees ? "Yes" : "No", "Producer splits")}
            </tbody>
          </table>
        </TableCard>
      )}

      {tab === "tax" && (
        <TableCard footer={foot(<>Tax categories are mapped on <Link className="underline" href="/app/tax">Tax summaries</Link>.</>)}>
          <table className={table} data-even="off">
            <SettingHead />
            <tbody>
              <SettingLine id="tax" label="1099 threshold" now={<span title="Check the year's IRS figure; it moves">{dollars(s.tax1099ThresholdCents)}</span>} usedBy={<A href="/app/tax">Tax summaries › Contractors</A>} {...line("threshold", ["tax1099ThresholdCents"])} />
              {row("taxIds", ["taxIdViewerRoles"], "Who may see payee tax IDs", s.taxIdViewerRoles.includes("bookkeeper") ? "Owner and bookkeepers" : "Owner only", "Reveal tax ID on a payee")}
              {lockRow("tax_notice", "The tax notice", "Shown on every tax screen and export; can't be edited", <span className="mb-1.5 block italic">{TAX_NOTICE}</span>)}
            </tbody>
          </table>
        </TableCard>
      )}

      {open && <AccountingSettingDialog key={open} which={open} settings={s} canEdit={canEdit} busy={busy} onSave={save} onClose={() => setOpen(null)} />}
    </div>
  );
}
