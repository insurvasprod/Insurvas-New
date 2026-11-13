/**
 * Accounting's rail (round 7, owner 2026-11-10: docs/la4/mockups-r7/accounting.html 0·B). To do first (everything
 * that waits on a person), then the steps grouped as the money moves: Money in (Bank deposits), Money out
 * (Vendor bills, Expenses, Producer splits, and Team payouts and Partner payouts, which live in Commissions since
 * its round 7 and open there), Your books (Profit & loss, Tax summaries). Accounting settings sits at the
 * rail's foot. Vendor returns is the Returns tab of Vendor bills; My balance is the Producer splits step as a
 * producer sees it. A plain module so the server frame, the sidebar and the page trail read one list.
 */
/** The Accounting menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const ACCOUNTING_RAIL_COOKIE = "insurvas_accounting_rail";

/** `payouts`, `producerPayouts` and `commissionSplits` are Commissions pages now; the first two keep a row here that opens there. */
export type AccountingStep = "todo" | "pnl" | "bank" | "bills" | "expenses" | "payouts" | "producerPayouts" | "splits" | "commissionSplits" | "tax";

/** `icon`: the sidebar's own icon for the page. `elsewhere`: the area the row opens in. Splits opens as My balance for a producer (accounting-page.tsx). */
export const ACCOUNTING_STEPS: { key: AccountingStep; label: string; href: string; icon: string; group?: string; elsewhere?: string }[] = [
  { key: "todo", label: "To do", href: "/app/accounting", icon: "list-todo" },
  { key: "bank", label: "Bank deposits", href: "/app/bank", icon: "landmark", group: "Money in" },
  { key: "bills", label: "Vendor bills", href: "/app/vendor-bills", icon: "receipt-text", group: "Money out" },
  { key: "expenses", label: "Expenses", href: "/app/expenses", icon: "credit-card", group: "Money out" },
  { key: "splits", label: "Producer splits", href: "/app/producer-splits", icon: "split", group: "Money out" },
  // Commissions round 7 (owner 2026-11-10, mockups-r7/commissions.html 0·A): paying producers and partners is Commissions'.
  { key: "producerPayouts", label: "Team payouts", href: "/app/producer-payouts", icon: "banknote", group: "Money out", elsewhere: "Commissions" },
  { key: "payouts", label: "Partner payouts", href: "/app/payouts", icon: "wallet-cards", group: "Money out", elsewhere: "Commissions" },
  { key: "pnl", label: "Profit & loss", href: "/app/pnl", icon: "chart-line", group: "Your books" },
  { key: "tax", label: "Tax summaries", href: "/app/tax", icon: "file-chart-column", group: "Your books" },
];

/** At the rail's foot (owner and bookkeeper; the page itself says who may change what). */
export const ACCOUNTING_SETTINGS_FOOT = { label: "Accounting settings", href: "/app/accounting-settings" } as const;

/** A producer's Splits step: their own balance, at its own address. */
export const MY_BALANCE = { label: "My balance", href: "/app/my-balance", icon: "wallet" } as const;

/**
 * Each step's addresses. Vendor returns and the older Invoices address are Vendor bills; My balance is Splits.
 * A record under a step (an invoice, an expense, a producer, a payee, a P&L line's entries) is that step too,
 * so the rail and the sidebar stay on it.
 */
const STEP_PATHS: [RegExp, AccountingStep][] = [
  [/^\/app\/accounting$/, "todo"],
  [/^\/app\/pnl(\/.*)?$/, "pnl"],
  [/^\/app\/bank(\/.*)?$/, "bank"],
  [/^\/app\/(vendor-bills|vendor-returns|invoices)(\/.*)?$/, "bills"],
  [/^\/app\/expenses(\/.*)?$/, "expenses"],
  // Partner payouts, Team payouts (with its producer statements) and Commission splits are Commissions steps since
  // round 7 (owner 2026-11-10, mockups-r7/commissions.html 0·A): their rows on this rail open them there.
  [/^\/app\/(producer-splits|my-balance)(\/.*)?$/, "splits"],
  [/^\/app\/tax(\/.*)?$/, "tax"],
];

export function accountingStepOf(pathname: string): AccountingStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

/** The step's name where `pathname` is (My balance on its own address). */
export function accountingStepLabel(step: AccountingStep, pathname?: string): string {
  if (step === "splits" && pathname && /^\/app\/my-balance(\/|$)/.test(pathname)) return MY_BALANCE.label;
  if (step === "commissionSplits") return "Commission splits";
  return ACCOUNTING_STEPS.find((item) => item.key === step)?.label ?? "";
}

/** The step's own address where `pathname` is (My balance for a producer), for the trail's link back. */
export function accountingStepHref(step: AccountingStep, pathname?: string): string {
  if (step === "splits" && pathname && /^\/app\/my-balance(\/|$)/.test(pathname)) return MY_BALANCE.href;
  return ACCOUNTING_STEPS.find((item) => item.key === step)?.href ?? "/app/accounting";
}

/** What waits on a person per step (/api/app/accounting/steps); a step left out has no badge. */
export type AccountingStepCounts = Partial<Record<AccountingStep, number>>;

/** What each badge counts, one and many. Profit & loss and Splits have no queue, so no badge. */
export const ACCOUNTING_WAITING: Record<string, [string, string]> = {
  todo: ["thing waiting for you", "things waiting for you"],
  bank: ["carrier payment or deposit to look at", "carrier payments or deposits to look at"],
  bills: ["vendor bill to finish, approve or pay", "vendor bills to finish, approve or pay"],
  expenses: ["monthly bill to OK", "monthly bills to OK"],
  tax: ["payee missing 1099 details", "payees missing 1099 details"],
};
