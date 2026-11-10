/**
 * LA-7.3 (Notion sprint, Module 7 — Accounting) · platform and tool expenses, with no database.
 *
 * The one field that needs thought is whether an expense is an ACQUISITION cost (it divides into
 * cost per policy) or OVERHEAD (it only reduces net profit). Defaults per category, overridable per
 * expense; the defaults themselves are the agency's (accounting settings, LA-7.9).
 *
 * Owner, 2026-11-06 (expenses tracker): every expense goes into one of three BUCKETS — buying leads,
 * monthly subscriptions, daily & random. A bucket is a grouping of the detailed categories (which the P&L
 * and the tax export still read), so the form asks for the bucket and presets the category. `leads` is a
 * lead buy with no vendor invoice; it books as lead_cost, like an invoice (20261106120000).
 */

export const EXPENSE_CATEGORIES = ["leads", "software", "telephony", "data_services", "insurance", "professional_fees", "licensing", "office", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  leads: "Leads (no invoice)",
  software: "Software",
  telephony: "Telephony & dialer",
  data_services: "Data services",
  insurance: "Insurance",
  professional_fees: "Professional fees",
  licensing: "Licensing",
  office: "Office",
  other: "Other",
};

/** The shipped defaults (the migration's column default). The agency's own come from settings. */
export const DEFAULT_ACQUISITION: Record<ExpenseCategory, boolean> = {
  leads: true,
  software: true,
  telephony: true,
  data_services: true,
  insurance: false,
  professional_fees: false,
  licensing: false,
  office: false,
  other: false,
};

/** Shown wherever the choice is made: the reason the setting exists. */
export const ACQUISITION_CONSEQUENCE = "Acquisition costs divide into cost per policy. Overhead does not.";

export const RECURRENCES = ["one_off", "monthly", "quarterly", "annual"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const RECURRENCE_LABELS: Record<Recurrence, string> = { one_off: "One-off", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

export type ExpenseStatus = "template" | "unconfirmed" | "confirmed" | "void";

/** The ledger type a category books as. Mirrors expense_entry_type() in 20261015220000. */
export function entryTypeFor(category: ExpenseCategory): "lead_cost" | "insurance" | "professional_fee" | "tool_subscription" {
  if (category === "leads") return "lead_cost";
  if (category === "insurance") return "insurance";
  if (category === "professional_fees" || category === "licensing") return "professional_fee";
  return "tool_subscription";
}

/** The flag an expense gets: the person's explicit choice, else the agency's default for its category. */
export function acquisitionFor(category: ExpenseCategory, defaults: Partial<Record<ExpenseCategory, boolean>>, explicit?: boolean | null) {
  const fallback = defaults[category] ?? DEFAULT_ACQUISITION[category];
  if (explicit == null) return { isAcquisitionCost: fallback, overridden: false };
  return { isAcquisitionCost: explicit, overridden: explicit !== fallback };
}

/** Read the agency's per-category defaults from settings, ignoring anything that is not a known category. */
export function readDefaults(raw: unknown): Record<ExpenseCategory, boolean> {
  const out = { ...DEFAULT_ACQUISITION };
  if (raw && typeof raw === "object") {
    for (const c of EXPENSE_CATEGORIES) {
      const v = (raw as Record<string, unknown>)[c];
      if (typeof v === "boolean") out[c] = v;
    }
  }
  return out;
}

// ─── the three buckets (owner, 2026-11-06) ────────────────────────────────────────────────────

export const EXPENSE_BUCKETS = ["leads", "subscriptions", "daily"] as const;
export type ExpenseBucket = (typeof EXPENSE_BUCKETS)[number];
export const EXPENSE_BUCKET_COPY: Record<ExpenseBucket, { label: string; short: string; hint: string }> = {
  leads: { label: "Buying leads", short: "Leads", hint: "Leads bought without a vendor invoice. Invoices go in Vendor bills, and count here too." },
  subscriptions: { label: "Monthly subscriptions", short: "Subscriptions", hint: "The tools: CRM, dialer, data and other apps." },
  daily: { label: "Daily & random", short: "Daily & random", hint: "One-off and everyday costs: office supplies, a business lunch, fees." },
};

const SUBSCRIPTION_CATEGORIES: readonly ExpenseCategory[] = ["software", "telephony", "data_services"];

/** Which bucket a category belongs to. */
export function bucketOf(category: ExpenseCategory | string): ExpenseBucket {
  if (category === "leads") return "leads";
  return SUBSCRIPTION_CATEGORIES.includes(category as ExpenseCategory) ? "subscriptions" : "daily";
}

/** The categories inside a bucket, for the optional detail picker. */
export const categoriesIn = (bucket: ExpenseBucket): ExpenseCategory[] => EXPENSE_CATEGORIES.filter((c) => bucketOf(c) === bucket);

/** The detail a bucket starts with; the person may change it under More details. */
export function defaultCategoryFor(bucket: ExpenseBucket): ExpenseCategory {
  return bucket === "leads" ? "leads" : bucket === "subscriptions" ? "software" : "other";
}

/**
 * One booked cost line of a month, as the scoreboard reads it: a cost entry's amount (money out is
 * negative; a reversal nets it back) and, when it came from an expense, that expense's category. A
 * lead_cost with no expense is a vendor invoice — Leads.
 */
export type CostLine = { entryType: string; amountCents: number; expenseCategory: string | null };

export type Scoreboard = { totalCents: number; byBucket: Record<ExpenseBucket, number> };

/** The end-of-month scoreboard: what went out, in total and per bucket, as positive cents. */
export function scoreboard(lines: CostLine[]): Scoreboard {
  const byBucket: Record<ExpenseBucket, number> = { leads: 0, subscriptions: 0, daily: 0 };
  for (const l of lines) {
    const bucket: ExpenseBucket | null = l.expenseCategory ? bucketOf(l.expenseCategory) : l.entryType === "lead_cost" ? "leads" : null;
    if (!bucket) continue;
    byBucket[bucket] -= l.amountCents;
  }
  return { totalCents: byBucket.leads + byBucket.subscriptions + byBucket.daily, byBucket };
}

/** "2026-11" ± n months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
