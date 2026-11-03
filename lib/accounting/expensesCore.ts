/**
 * LA-7.3 (Notion sprint, Module 7 — Accounting) · platform and tool expenses, with no database.
 *
 * The one field that needs thought is whether an expense is an ACQUISITION cost (it divides into
 * cost per policy) or OVERHEAD (it only reduces net profit). Defaults per category, overridable per
 * expense; the defaults themselves are the agency's (accounting settings, LA-7.9).
 */

export const EXPENSE_CATEGORIES = ["software", "telephony", "data_services", "insurance", "professional_fees", "licensing", "office", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
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
export function entryTypeFor(category: ExpenseCategory): "insurance" | "professional_fee" | "tool_subscription" {
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
