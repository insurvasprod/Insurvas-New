"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { AccountingSettingSheet, BASIS_WORDS, CADENCE_WORDS, dollars, KEYS, MONTHS, SPLIT_OF_WORDS, valueWords, type Which } from "@/components/app/accounting/accounting-settings-dialogs";
import { useAccountingSave } from "@/components/app/accounting/accounting-settings-rows";
import { SectionTabs, useAnchorTab } from "@/components/app/settings/setting-row";
import {
  GroupRow, LockedSheet, NowCell, SettingFoot, SettingRow, SettingTable, shortDay, StatusLine, UsedCell, ValueCell, WhoCell,
  type Affect, type HistoryItem, type ValueKind,
} from "@/components/app/settings/money/setting-kit";
import { Button } from "@/components/ui/button";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/accounting/expensesCore";
import { percent } from "@/lib/accounting/producersCore";
import { ACCOUNTING_DEFAULTS, COLUMNS, type AccountingSettings } from "@/lib/accounting/settingsCore";
import { TAX_NOTICE } from "@/lib/accounting/taxCore";

/**
 * LA-7.9 · one place for everything LA-7 reads. It links to the screens that own commission schedules, partner
 * terms, carrier lags and vendors, and never edits them. Every change is recorded with who, what, from and to.
 *
 * Round 8 (docs/design/settings-r8/money-compliance-settings.html §1–3, owner "Build all four" 2026-11-12): the six
 * tabs stay on the title line (?tab=), with a History button beside them. Each tab is one card of one-line rows:
 * Setting · Now · Used by · Changed (gold avatar · date) · Value (Yours, Insurvas, Locked; Owner for a read-only
 * viewer) · ›. A row opens a right sheet that changes that one setting, with what it affects and its own history
 * (Put back on the newest change). A safety limit is a Locked row whose sheet says why, what it means and who to ask.
 * A status line under the title says what was saved last, or that a sheet is open with nothing saved yet.
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
const TAB_LABEL = Object.fromEntries(TABS.map((t) => [t.key, t.label])) as Record<Tab, string>;
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
/** A link in a cell: the cell's colour, underlined on hover (owner 2026-11-11, one colour per table). */
const A = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className="text-inherit hover:underline">{children}</Link>;
/** A Settings-search anchor inside a row's first cell (#tax opens the Tax tab and scrolls here). */
const Mark = ({ id }: { id: string }) => <span id={id} className="scroll-mt-24" aria-hidden="true" />;
const KEY_OF_COLUMN = Object.fromEntries(Object.entries(COLUMNS).map(([k, c]) => [c, k])) as Record<string, keyof AccountingSettings>;

/** A setting row's words: its label, the value now, what uses it, and what its sheet lists under What it affects. */
type Row = { which: Which; anchor?: ReactNode; label: string; now: ReactNode; nowTitle?: string; usedBy: ReactNode; affects: Affect[] };
type LockRow = { key: string; label: string; now: string; usedBy: string; means: Affect[]; extra?: ReactNode };
type Line = { kind: "group"; label: string } | ({ kind: "row" } & Row) | ({ kind: "lock" } & LockRow) | { kind: "page"; label: string; now: ReactNode; usedBy: ReactNode; href: string };

const BACKWARDS: Affect = { label: "Recorded figures keep their values", where: "Nothing changes backwards" };

export function AccountingSettingsBoard({ initial, locked, changes = [], accounts, canEdit, canSeeHistory = canEdit, readOnlyWhy, initialTab = "books" }: {
  initial: AccountingSettings;
  locked: readonly Locked[];
  changes?: Change[];
  accounts: Account[];
  canEdit: boolean;
  /** The owner: the History button. */
  canSeeHistory?: boolean;
  /** Why the rows don't save for this viewer: "owner" (a bookkeeper) or "paused" (the plan is read-only). */
  readOnlyWhy?: "owner" | "paused";
  initialTab?: Tab;
}) {
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>(initialTab);
  // The tab is kept in the address (?tab=), without a round trip to the server.
  const [open, setOpen] = useState<Which | null>(null);
  const [lockOpen, setLockOpen] = useState<string | null>(null);
  // A tab change (a click, or a search link's #anchor) closes any open sheet.
  const setTab = useCallback((next: Tab) => {
    setOpen(null);
    setLockOpen(null);
    setTabState(next);
    try { const query = new URLSearchParams(window.location.search); query.set("tab", next); window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}${window.location.hash}`); } catch { /* the tab still shows */ }
  }, []);
  useAnchorTab(SECTION_TAB, setTab);
  const [s, setS] = useState(initial);
  const [log, setLog] = useState<Change[]>(changes);
  // A save adds its own lines to the history at once (the page's change list reloads on refresh).
  const onSaved = (next: AccountingSettings) => {
    const at = new Date().toISOString();
    const added = (Object.keys(next) as (keyof AccountingSettings)[]).filter((k) => !same(next[k], s[k])).map((k) => ({ field: COLUMNS[k], from: s[k], to: next[k], at, name: "You" }));
    setLog((cur) => [...added, ...cur]);
    setS(next);
  };
  const { busy, error, setError, save } = useAccountingSave(s, onSaved);
  const lock = (key: string) => locked.find((l) => l.key === key);
  const ownerOnly = readOnlyWhy === "owner" || (!canEdit && readOnlyWhy !== "paused");

  const lastOf = (keys: (keyof AccountingSettings)[]) => { const columns = keys.map((k) => COLUMNS[k]); return log.find((c) => columns.includes(c.field)) ?? null; };
  const valueOf = (keys: (keyof AccountingSettings)[]): ValueKind => (ownerOnly ? "owner" : keys.some((k) => !same(s[k], ACCOUNTING_DEFAULTS[k])) ? "yours" : "insurvas");
  /** A sheet's history: each recorded change to its keys, newest first; the newest can be put back. */
  const historyOf = (which: Which, title: string): HistoryItem[] => {
    const keys = KEYS[which];
    const columns = keys.map((k) => COLUMNS[k]);
    const mine = log.filter((c) => columns.includes(c.field)).slice(0, 6);
    return mine.map((c, i) => {
      const key = KEY_OF_COLUMN[c.field];
      const words = `${valueWords(key, c.from)} → ${valueWords(key, c.to)}`;
      const putBack = i === 0 && canEdit && key && same(s[key], c.to) ? () => void save({ [key]: c.from } as Partial<AccountingSettings>, title) : null;
      return { key: `${c.field}-${c.at}-${i}`, who: c.name ?? "Someone", at: c.at, line: keys.length > 1 ? <>{fieldLabel(key)}: {words}</> : words, onPutBack: putBack };
    });
  };

  const acquisition = EXPENSE_CATEGORIES.filter((c) => s.acquisitionDefaults[c]);
  const overhead = EXPENSE_CATEGORIES.filter((c) => !s.acquisitionDefaults[c]);
  const categoryNames = (list: readonly (typeof EXPENSE_CATEGORIES)[number][]) => list.map((c) => EXPENSE_CATEGORY_LABELS[c]).join(" · ");
  const account = (a: Account) => `${a.nickname}${a.lastFour ? ` ••${a.lastFour}` : ""}`;

  const lines: Record<Tab, Line[]> = {
    books: [
      { kind: "group", label: "When money counts" },
      { kind: "row", which: "basis", anchor: <Mark id="reporting" />, label: "Count money when", now: BASIS_WORDS[s.defaultBasis], usedBy: <><A href="/app/pnl">P&amp;L</A>, <A href="/app/tax">Tax summaries</A>, Producer statements</>,
        affects: [{ label: "Every Profit & loss view opens on it", where: "Accounting › P&L" }, { label: "Tax summaries and producer statements", where: "Tax · My balance" }, BACKWARDS] },
      { kind: "row", which: "fy", label: "Your financial year starts", now: MONTHS[s.fyStartMonth - 1], usedBy: "Year-to-date figures, Tax", affects: [{ label: "Year-to-date figures start here", where: "P&L · Dashboards" }, { label: "The tax year's summaries", where: "Tax summaries" }, BACKWARDS] },
      { kind: "group", label: "Persistency" },
      { kind: "row", which: "persist", label: "Count a policy as persisting at", now: `Month ${s.persistencyMonth}`, usedBy: <A href="/app/pnl">P&amp;L › Persisting cost</A>, affects: [{ label: "Cost per persisting policy", where: "Accounting › P&L" }, BACKWARDS] },
      { kind: "row", which: "sample", label: "Show counts instead of a rate below", now: plural(s.sampleThreshold, "policy", "policies"), usedBy: "Cost per policy on the P&L", affects: [{ label: "Cost per policy tiles show two counts instead of a rate", where: "Accounting › P&L" }] },
      { kind: "group", label: "Safety" },
      { kind: "lock", key: "recorded_figures", label: "Recorded figures never change", now: "A change counts from now on", usedBy: "Every money page",
        means: [{ label: "A new setting applies to what is recorded next", where: "Every money page" }, { label: "A report you already sent still adds up", where: "P&L · Tax · Statements" }] },
    ],
    bank: [
      { kind: "row", which: "bankWindow", anchor: <Mark id="bank-matching" />, label: "Look for the deposit up to", now: `${plural(s.bankWindowDays, "day")} after the carrier's date`, usedBy: <A href="/app/bank">Bank deposits › Payments</A>,
        affects: [{ label: "Missing money is flagged after this", where: "Bank deposits › Payments" }] },
      { kind: "row", which: "bankTol", label: "Suggest a match when the amounts differ by up to", now: s.bankAmountToleranceCents === 0 ? "$0.00 · amounts must agree" : dollars(s.bankAmountToleranceCents), usedBy: "Deposits › suggestions",
        affects: [{ label: "Which deposits are suggested as a payment's match", where: "Bank deposits" }, { label: "A person still confirms every match", where: "Nothing is applied for you" }] },
      { kind: "page", label: "Bank accounts", href: "/app/bank?view=accounts", usedBy: <A href="/app/bank?view=accounts">Bank deposits › Accounts</A>,
        now: accounts.length ? (accounts.length === 1 ? account(accounts[0]) : plural(accounts.length, "account")) : "None yet" },
      { kind: "lock", key: "bank_auto_apply", label: "Matches are never applied for you", now: "A person confirms each one", usedBy: "Bank deposits",
        means: [{ label: "A match is a suggestion until someone confirms it", where: "Bank deposits › Payments" }, { label: "Your P&L shows only matches a person agreed", where: "Accounting › P&L" }] },
    ],
    bills: [
      { kind: "row", which: "invoiceTol", anchor: <Mark id="vendor-bills" />, label: "Flag a bill that differs from your count by more than", now: dollars(s.invoiceToleranceCents), usedBy: <A href="/app/invoices">Vendor bills</A>,
        affects: [{ label: "Vendor bills · Needs you count", where: "Accounting › Vendor bills" }, { label: "Billed more than you got", where: "Vendor bills" }, { label: "Recorded bills keep their status", where: "Nothing changes backwards" }] },
      { kind: "lock", key: "recurring_confirmation", label: "Monthly bills wait for your OK", now: "Always, before they book", usedBy: "Vendor bills, Expenses",
        means: [{ label: "A repeating bill is drafted, then waits for you", where: "Accounting › To do" }, { label: "Nothing books cost you didn't agree", where: "Expenses" }] },
      { kind: "row", which: "categories", anchor: <Mark id="acquisition-or-overhead" />, label: "Expense groups on the P&L", now: `${plural(acquisition.length, "acquisition category", "acquisition categories")} · ${overhead.length} overhead`, nowTitle: `Acquisition: ${categoryNames(acquisition) || "none"}. Overhead: ${categoryNames(overhead) || "none"}.`, usedBy: "P&L, Cost per policy",
        affects: [{ label: "New expenses in each category", where: "Expenses" }, { label: "Cost per policy counts acquisition only", where: "Accounting › P&L" }, { label: "Expenses already booked keep their group", where: "Change them on Expenses" }] },
    ],
    payouts: [
      { kind: "row", which: "autoPublish", anchor: <Mark id="partner-payouts" />, label: "When a payout run is ready", now: s.payoutAutoPublish ? "Publish to the partner" : "Wait for my review", usedBy: <A href="/app/payouts">Partner payouts</A>,
        affects: [{ label: "Whether a new run reaches the partner at once", where: "Partner payouts" }, { label: "Partners see a published statement", where: "Partner portal" }] },
      { kind: "row", which: "cadence", label: "Pay partners", now: `${CADENCE_WORDS[s.payoutCadence]} · draft ${plural(s.payoutDraftDays, "day")} after the period ends`, usedBy: "The next draft run",
        affects: [{ label: "When the next draft run appears", where: "Partner payouts" }, { label: "Runs already made keep their period", where: "Nothing changes backwards" }] },
      { kind: "row", which: "footer", label: "Statement footer", now: s.payoutStatementFooter ? `"${s.payoutStatementFooter}"` : "None", nowTitle: s.payoutStatementFooter ?? undefined, usedBy: "Every partner statement",
        affects: [{ label: "The foot of every statement a partner reads", where: "Partner portal" }] },
      { kind: "row", which: "disputeTol", label: "Ignore partner disputes under", now: s.payoutDisputeToleranceCents === 0 ? "Every dispute is reviewed" : dollars(s.payoutDisputeToleranceCents), usedBy: "Disputes on a run",
        affects: [{ label: "Disputes below it are accepted without review", where: "Partner payouts › a run" }] },
      { kind: "lock", key: "no_outbound_payments", label: "Insurvas sends money", now: "Never · runs are calculated and recorded", usedBy: "Partner payouts",
        means: [{ label: "A payout run is worked out and recorded", where: "Partner payouts" }, { label: "You mark a run as paid once your bank sends it", where: "Run › Mark paid" }, { label: "Partners see the statement, not a transfer", where: "Partner portal" }] },
    ],
    producers: [
      { kind: "row", which: "seeBalance", anchor: <Mark id="producer-splits" />, label: "Producers see their own balance", now: s.producersSeeBalance ? "Yes" : "No", usedBy: <A href="/app/my-balance">My balance</A>,
        affects: [{ label: "A producer's own balance, chargebacks included", where: "My balance" }] },
      { kind: "row", which: "negative", label: "When someone's balance goes below zero", usedBy: <>Run payroll, <A href="/app/producer-splits">Producer splits</A></>,
        now: s.producerNegativePolicy === "carry_forward" ? "Carry it to their next pay" : s.producerNegativePolicy === "cap" ? `Take ${percent(s.producerRecoveryCapBp)} of what they owe each month` : "Let it go",
        affects: [{ label: "The choice Run payroll starts with for anyone below zero", where: "Run payroll" }, { label: "You can still change it per person in the draft", where: "Producer splits" }] },
      { kind: "row", which: "split", label: "Default split for a new producer", now: s.producerDefaultSplitBp == null ? "None" : `${percent(s.producerDefaultSplitBp)} ${SPLIT_OF_WORDS[s.producerDefaultBasis]}`, usedBy: "Adding a producer",
        affects: [{ label: "Filled in when you add a producer", where: "Producer splits" }, { label: "Each producer's own split wins", where: "Nothing changes backwards" }] },
      { kind: "row", which: "shareFees", label: "Share carrier fees with producers", now: s.producerShareFees ? "Yes" : "No", usedBy: "Producer splits",
        affects: [{ label: "Carrier fees split like the commission", where: "Producer splits" }] },
    ],
    tax: [
      { kind: "row", which: "threshold", anchor: <Mark id="tax" />, label: "1099 threshold", now: dollars(s.tax1099ThresholdCents), nowTitle: "Check the year's IRS figure; it moves", usedBy: <A href="/app/tax">Tax summaries › Contractors</A>,
        affects: [{ label: "Who appears in the 1099 summary", where: "Tax summaries › Contractors" }] },
      { kind: "row", which: "taxIds", label: "Who may see payee tax IDs", now: s.taxIdViewerRoles.includes("bookkeeper") ? "Owner and bookkeepers" : "Owner only", usedBy: "Reveal tax ID on a payee",
        affects: [{ label: "Who can reveal a payee's full tax ID", where: "Payees" }, { label: "Every reveal is recorded with who and when", where: "Settings history" }] },
      { kind: "lock", key: "tax_notice", label: "The tax notice", now: "Shown on every tax screen and export", usedBy: "Tax summaries, exports",
        means: [{ label: "Shown on every tax screen", where: "Tax summaries" }, { label: "Printed on every tax export", where: "Exports" }], extra: <p className="m-0 text-sm italic text-[var(--body)]">{TAX_NOTICE}</p> },
    ],
  };

  const rowsHere = lines[tab].filter((l): l is { kind: "row" } & Row => l.kind === "row");
  const allRows = (Object.values(lines).flat()).filter((l): l is { kind: "row" } & Row => l.kind === "row");
  const valuesHere: ValueKind[] = lines[tab].flatMap((l) => (l.kind === "row" ? [valueOf(KEYS[l.which])] : l.kind === "lock" ? ["locked" as const] : []));
  const openRow = open ? allRows.find((r) => r.which === open) ?? null : null;
  const openLock = lockOpen ? lines[tab].find((l): l is { kind: "lock" } & LockRow => l.kind === "lock" && l.key === lockOpen) ?? null : null;
  const lockWhy = (key: string) => lock(key)?.reason ?? "A change counts from now on. Figures already recorded keep the setting they were made with, so a statement or report you already sent still adds up.";

  /** The status line: read-only, a sheet open, or the newest change on this tab (else anywhere). */
  const status = (() => {
    if (!canEdit) return <StatusLine tone="warn">{ownerOnly ? "Read-only: only the owner changes these. Values and their history show." : "Read-only: your plan's billing is paused. Values show, nothing saves."}</StatusLine>;
    if (openRow) return <StatusLine tone="warn">{openRow.label} being changed · nothing saved yet</StatusLine>;
    const tabColumns = rowsHere.flatMap((r) => KEYS[r.which].map((k) => COLUMNS[k]));
    const last = log.find((c) => tabColumns.includes(c.field)) ?? log[0];
    if (!last) return <StatusLine>Every setting is on Insurvas&apos;s value · changes count from now on, recorded figures stay as they are</StatusLine>;
    const row = allRows.find((r) => KEYS[r.which].some((k) => COLUMNS[k] === last.field));
    return <StatusLine>Saved · {row?.label ?? "A setting"} changed by {last.name ?? "someone"} on {shortDay(last.at)} · changes count from now on, recorded figures stay as they are</StatusLine>;
  })();

  const footNote: Record<Tab, ReactNode> = {
    books: null,
    bank: null,
    bills: <>Vendors and campaigns are set on <Link className="underline" href="/app/campaigns">Campaigns</Link></>,
    payouts: <>Payout terms are kept on each partner, <Link className="underline" href="/app/publishers">Partners</Link></>,
    producers: <>Commission schedules and contract levels are on the <Link className="underline" href="/app/rate-card">Rate card</Link></>,
    tax: <>Tax categories are mapped on <Link className="underline" href="/app/tax">Tax summaries</Link></>,
  };

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-3">
      <SectionTabs label="Accounting settings" tabs={TABS} value={tab} onChange={setTab}
        actions={canSeeHistory ? <Button asChild variant="outline"><Link href={HISTORY}>History</Link></Button> : undefined} />
      {status}

      <SettingTable fill footer={<SettingFoot values={valuesHere}>{footNote[tab]}</SettingFoot>}>
        <tbody>
          {lines[tab].map((l, i) => {
            if (l.kind === "group") return <GroupRow key={`g-${l.label}`}>{l.label}</GroupRow>;
            if (l.kind === "lock") {
              if (l.key !== "recorded_figures" && !lock(l.key)) return null;
              return (
                <SettingRow key={l.key} label={l.label} selected={lockOpen === l.key} onOpen={() => { setOpen(null); setLockOpen(l.key); }}>
                  <NowCell>{l.now}</NowCell><UsedCell>{l.usedBy}</UsedCell><WhoCell rule /><ValueCell value="locked" />
                </SettingRow>
              );
            }
            if (l.kind === "page") {
              return (
                <SettingRow key={`p-${i}`} label={l.label} onOpen={() => router.push(l.href)}>
                  <NowCell>{l.now}</NowCell><UsedCell>{l.usedBy}</UsedCell><td className="hidden whitespace-nowrap text-[var(--muted)] md:table-cell">Kept on Bank deposits</td><td />
                </SettingRow>
              );
            }
            const last = lastOf(KEYS[l.which]);
            return (
              <SettingRow key={l.which} anchor={l.anchor} label={l.label} selected={open === l.which} onOpen={() => { setLockOpen(null); setError(null); setOpen(l.which); }}>
                <NowCell title={l.nowTitle}>{l.now}</NowCell>
                <UsedCell>{l.usedBy}</UsedCell>
                <WhoCell name={last?.name} at={last?.at} />
                <ValueCell value={valueOf(KEYS[l.which])} title={ownerOnly ? "Only the owner changes these" : undefined} />
              </SettingRow>
            );
          })}
        </tbody>
      </SettingTable>

      {openRow && (
        <AccountingSettingSheet key={openRow.which} which={openRow.which} where={TAB_LABEL[tab]} settings={s} canEdit={canEdit}
          readOnlyWhy={ownerOnly ? "Only the owner changes this." : "Your plan's billing is paused, so nothing saves."}
          busy={busy} error={error} affects={openRow.affects} history={historyOf(openRow.which, openRow.label)} historyHref={canSeeHistory ? HISTORY : undefined}
          onSave={save} onClose={() => { setOpen(null); setError(null); }} />
      )}
      {openLock && (
        <LockedSheet title={openLock.label} where={`Accounting › ${TAB_LABEL[tab]}`} why={lockWhy(openLock.key)} means={openLock.means} onClose={() => setLockOpen(null)}>
          {openLock.extra}
        </LockedSheet>
      )}
    </div>
  );
}

/** A field's name inside a two-part history line ("Draft days: 3 days → 5 days"). */
function fieldLabel(key: keyof AccountingSettings) {
  const names: Partial<Record<keyof AccountingSettings, string>> = {
    payoutCadence: "How often", payoutDraftDays: "Draft after", producerNegativePolicy: "Choice", producerRecoveryCapBp: "Share",
    producerDefaultSplitBp: "Share", producerDefaultBasis: "Of",
  };
  return names[key] ?? key;
}
