/**
 * LA-7.9 (Notion sprint, Module 7 — Accounting) · accounting settings, with no database.
 *
 * Every LA-7 setting lives in accounting_settings and is read from here. ACCOUNTING_DEFAULTS mirrors
 * the migrations' column defaults (asserted by test) and is used only when an agency has no row yet;
 * no other threshold, horizon, cadence or tax figure is written anywhere else in LA-7.
 *
 * Some things are not preferences but safety limits, shown and never editable: recurring expenses
 * are always confirmed before they book; bank matches are never applied automatically; no money is
 * moved anywhere in LA-7; the not-tax-advice notice cannot be edited or hidden.
 */

import { DEFAULT_ACQUISITION, readDefaults, type ExpenseCategory } from "./expensesCore.ts";

export type AccountingSettings = {
  defaultBasis: "accrual" | "cash";
  fyStartMonth: number;
  persistencyMonth: 3 | 6 | 9 | 13;
  sampleThreshold: number;
  acquisitionDefaults: Record<ExpenseCategory, boolean>;
  invoiceToleranceCents: number;
  payoutCadence: "monthly" | "semi_monthly" | "weekly";
  payoutDraftDays: number;
  payoutAutoPublish: boolean;
  payoutStatementFooter: string | null;
  /** A partner's dispute under this is ignored (LA-7.9 "dispute tolerance"); 0 = every difference counts. */
  payoutDisputeToleranceCents: number;
  producerDefaultSplitBp: number | null;
  producerDefaultBasis: "advance" | "earned" | "both";
  producerNegativePolicy: "carry_forward" | "cap" | "write_off";
  producerRecoveryCapBp: number;
  producersSeeBalance: boolean;
  producerShareFees: boolean;
  bankAmountToleranceCents: number;
  bankWindowDays: number;
  tax1099ThresholdCents: number;
  taxIdViewerRoles: ("owner" | "bookkeeper")[];
};

export const ACCOUNTING_DEFAULTS: AccountingSettings = {
  defaultBasis: "accrual",
  fyStartMonth: 1,
  persistencyMonth: 9,
  sampleThreshold: 10,
  acquisitionDefaults: DEFAULT_ACQUISITION,
  invoiceToleranceCents: 5000,
  payoutCadence: "monthly",
  payoutDraftDays: 3,
  payoutAutoPublish: false,
  payoutStatementFooter: null,
  payoutDisputeToleranceCents: 0,
  producerDefaultSplitBp: null,
  producerDefaultBasis: "advance",
  producerNegativePolicy: "carry_forward",
  producerRecoveryCapBp: 5000,
  producersSeeBalance: true,
  producerShareFees: false,
  bankAmountToleranceCents: 0,
  bankWindowDays: 21,
  tax1099ThresholdCents: 200000,
  taxIdViewerRoles: ["owner"],
};

/** The settings column each field is stored in. */
export const COLUMNS: Record<keyof AccountingSettings, string> = {
  defaultBasis: "default_basis",
  fyStartMonth: "fy_start_month",
  persistencyMonth: "persistency_month",
  sampleThreshold: "sample_threshold",
  acquisitionDefaults: "acquisition_defaults",
  invoiceToleranceCents: "invoice_tolerance_cents",
  payoutCadence: "payout_cadence",
  payoutDraftDays: "payout_draft_days",
  payoutAutoPublish: "payout_auto_publish",
  payoutStatementFooter: "payout_statement_footer",
  payoutDisputeToleranceCents: "payout_dispute_tolerance_cents",
  producerDefaultSplitBp: "producer_default_split_bp",
  producerDefaultBasis: "producer_default_basis",
  producerNegativePolicy: "producer_negative_policy",
  producerRecoveryCapBp: "producer_recovery_cap_bp",
  producersSeeBalance: "producers_see_balance",
  producerShareFees: "producer_share_fees",
  bankAmountToleranceCents: "bank_amount_tolerance_cents",
  bankWindowDays: "bank_window_days",
  tax1099ThresholdCents: "tax_1099_threshold_cents",
  taxIdViewerRoles: "tax_id_viewer_roles",
};

/** A settings row (or none) as typed settings; anything missing or malformed falls back to the default. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromRow(row: Record<string, any> | null | undefined): AccountingSettings {
  const d = ACCOUNTING_DEFAULTS;
  if (!row) return { ...d, acquisitionDefaults: { ...d.acquisitionDefaults } };
  const num = (v: unknown, fallback: number) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v));
  return {
    defaultBasis: row.default_basis === "cash" ? "cash" : "accrual",
    fyStartMonth: num(row.fy_start_month, d.fyStartMonth),
    persistencyMonth: ([3, 6, 9, 13].includes(Number(row.persistency_month)) ? Number(row.persistency_month) : d.persistencyMonth) as AccountingSettings["persistencyMonth"],
    sampleThreshold: num(row.sample_threshold, d.sampleThreshold),
    acquisitionDefaults: readDefaults(row.acquisition_defaults),
    invoiceToleranceCents: num(row.invoice_tolerance_cents, d.invoiceToleranceCents),
    payoutCadence: ["monthly", "semi_monthly", "weekly"].includes(row.payout_cadence) ? row.payout_cadence : d.payoutCadence,
    payoutDraftDays: num(row.payout_draft_days, d.payoutDraftDays),
    payoutAutoPublish: row.payout_auto_publish === true,
    payoutStatementFooter: typeof row.payout_statement_footer === "string" ? row.payout_statement_footer : null,
    payoutDisputeToleranceCents: num(row.payout_dispute_tolerance_cents, d.payoutDisputeToleranceCents),
    producerDefaultSplitBp: row.producer_default_split_bp == null ? null : Number(row.producer_default_split_bp),
    producerDefaultBasis: ["advance", "earned", "both"].includes(row.producer_default_basis) ? row.producer_default_basis : d.producerDefaultBasis,
    producerNegativePolicy: ["carry_forward", "cap", "write_off"].includes(row.producer_negative_policy) ? row.producer_negative_policy : d.producerNegativePolicy,
    producerRecoveryCapBp: num(row.producer_recovery_cap_bp, d.producerRecoveryCapBp),
    producersSeeBalance: row.producers_see_balance !== false,
    producerShareFees: row.producer_share_fees === true,
    bankAmountToleranceCents: num(row.bank_amount_tolerance_cents, d.bankAmountToleranceCents),
    bankWindowDays: num(row.bank_window_days, d.bankWindowDays),
    tax1099ThresholdCents: num(row.tax_1099_threshold_cents, d.tax1099ThresholdCents),
    taxIdViewerRoles: Array.isArray(row.tax_id_viewer_roles) && row.tax_id_viewer_roles.includes("owner") ? row.tax_id_viewer_roles : [...d.taxIdViewerRoles],
  };
}

/** Safety limits: shown on the settings screen with their reason, never editable, never in the settings API. */
export const LOCKED = [
  { key: "recurring_confirmation", label: "Recurring expenses are confirmed before they book", reason: "A subscription cancelled in March must not keep booking cost through December because nobody told the system. Generating the row is a convenience; booking the money unasked would be a quiet lie in a financial report." },
  { key: "bank_auto_apply", label: "Bank matches are applied automatically — unavailable", reason: "A wrong automatic match produces a reconciled-looking P&L that is wrong, which is worse than an unreconciled one that is honest. Every match is confirmed by a person." },
  { key: "no_outbound_payments", label: "No money is moved", reason: "Payout runs and splits are calculated and recorded; you pay as you do today. Sending money for someone is money transmission." },
  { key: "tax_notice", label: "The not-tax-advice notice", reason: "Shown on every tax screen and export, and cannot be edited or hidden." },
] as const;

/** The fields that changed, old and new, for the audit trail. */
export function diff(before: AccountingSettings, after: AccountingSettings) {
  return (Object.keys(after) as (keyof AccountingSettings)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: COLUMNS[k], from: before[k], to: after[k] }));
}
