/**
 * Accounting, one page (owner 2026-11-02, "like Data in"): six steps in the order a month runs — Profit &
 * loss first (did it make money), then Bank deposits, Vendor bills, Expenses, Partner payouts (moved from
 * Partners 2026-11-03, LA-7.4), Producer splits and Tax summaries. Two pages fold into others: Vendor returns is the Returns tab of Vendor bills, and My balance
 * is the Producer splits step as a producer sees it. A plain module so the server frame, the sidebar and
 * the page trail read one list.
 */
/** The Accounting menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const ACCOUNTING_RAIL_COOKIE = "insurvas_accounting_rail";

export type AccountingStep = "pnl" | "bank" | "bills" | "expenses" | "payouts" | "producerPayouts" | "splits" | "commissionSplits" | "tax";

/** `icon`: the sidebar's own icon for the page. Splits opens as My balance for a producer (accounting-page.tsx). */
export const ACCOUNTING_STEPS: { key: AccountingStep; label: string; href: string; icon: string }[] = [
  { key: "pnl", label: "Profit & loss", href: "/app/pnl", icon: "chart-line" },
  { key: "bank", label: "Bank deposits", href: "/app/bank", icon: "landmark" },
  { key: "bills", label: "Vendor bills", href: "/app/vendor-bills", icon: "receipt-text" },
  { key: "expenses", label: "Expenses", href: "/app/expenses", icon: "credit-card" },
  // LA-7.4 (owner 2026-11-03): partner payout runs moved here from Partners, where Module 7 puts them.
  { key: "payouts", label: "Partner payouts", href: "/app/payouts", icon: "wallet-cards" },
  // AG-1.7 (owner 2026-11-03): the agency's producer payout runs, moved here from Team at the same address.
  { key: "producerPayouts", label: "Team payouts", href: "/app/producer-payouts", icon: "banknote" },
  { key: "splits", label: "Producer splits", href: "/app/producer-splits", icon: "split" },
  // AG-1.6 (owner 2026-11-03): policies two producers share, moved here from Team at the same address.
  { key: "commissionSplits", label: "Commission splits", href: "/app/commission-splits", icon: "hand-coins" },
  { key: "tax", label: "Tax summaries", href: "/app/tax", icon: "file-chart-column" },
];

/** A producer's Splits step: their own balance, at its own address. */
export const MY_BALANCE = { label: "My balance", href: "/app/my-balance", icon: "wallet" } as const;

/**
 * Each step's addresses. Vendor returns and the older Invoices address are Vendor bills; My balance is Splits.
 * A record under a step (an invoice, a producer, a payee, a P&L line's entries; foundation pass 2026-11-03) is
 * that step too, so the rail and the sidebar stay on it.
 */
const STEP_PATHS: [RegExp, AccountingStep][] = [
  [/^\/app\/pnl(\/.*)?$/, "pnl"],
  [/^\/app\/bank(\/.*)?$/, "bank"],
  [/^\/app\/(vendor-bills|vendor-returns|invoices)(\/.*)?$/, "bills"],
  [/^\/app\/expenses(\/.*)?$/, "expenses"],
  [/^\/app\/payouts(\/.*)?$/, "payouts"],
  // A producer statement (/app/producer-statements/<run>) is a record of Producer payouts (2026-11-03).
  [/^\/app\/(producer-payouts|producer-statements)(\/.*)?$/, "producerPayouts"],
  [/^\/app\/(producer-splits|my-balance)(\/.*)?$/, "splits"],
  [/^\/app\/commission-splits(\/.*)?$/, "commissionSplits"],
  [/^\/app\/tax(\/.*)?$/, "tax"],
];

export function accountingStepOf(pathname: string): AccountingStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

/** The step's name where `pathname` is (My balance on its own address). */
export function accountingStepLabel(step: AccountingStep, pathname?: string): string {
  if (step === "splits" && pathname && /^\/app\/my-balance(\/|$)/.test(pathname)) return MY_BALANCE.label;
  return ACCOUNTING_STEPS.find((item) => item.key === step)?.label ?? "";
}

/** The step's own address where `pathname` is (My balance for a producer), for the trail's link back. */
export function accountingStepHref(step: AccountingStep, pathname?: string): string {
  if (step === "splits" && pathname && /^\/app\/my-balance(\/|$)/.test(pathname)) return MY_BALANCE.href;
  return ACCOUNTING_STEPS.find((item) => item.key === step)?.href ?? "/app/pnl";
}

/** What waits on a person per step (/api/app/accounting/steps); a step left out has no badge. */
export type AccountingStepCounts = Partial<Record<AccountingStep, number>>;

/** What each badge counts, one and many. P&L, Splits and Tax have no queue, so no badge; Partner payouts counts drafts. */
export const ACCOUNTING_WAITING: Record<string, [string, string]> = {
  bank: ["deposit to match to a carrier payment", "deposits to match to a carrier payment"],
  bills: ["vendor invoice to approve", "vendor invoices to approve"],
  expenses: ["recurring expense to confirm", "recurring expenses to confirm"],
  payouts: ["partner payout run to review", "partner payout runs to review"],
};
