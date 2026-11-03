/**
 * LA-7.8 (Notion sprint, Module 7 — Accounting) · 1099 figures and the tax-ready export, with no
 * database. Figures from records the agency holds — never advice, never a filing, never the
 * official form.
 */

/** Shown on both tax screens and at the top of every export. Not dismissible; not editable (LA-7.9). */
export const TAX_NOTICE = "These figures come from the transactions you have recorded. They are not tax advice and have not been reviewed by an accountant. Check them before filing.";

export const TAX_CATEGORIES = ["gross_receipts", "returns_allowances", "advertising", "contract_labor", "commissions_paid", "software", "insurance", "professional_fees", "licenses", "office", "bank_charges", "other"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];
export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  gross_receipts: "Gross receipts (commission income)",
  returns_allowances: "Returns and allowances (chargebacks)",
  advertising: "Advertising (lead costs)",
  contract_labor: "Contract labor (partner payouts)",
  commissions_paid: "Commissions paid (producer splits)",
  software: "Software and subscriptions",
  insurance: "Insurance",
  professional_fees: "Legal and professional fees",
  licenses: "Licenses",
  office: "Office expense",
  bank_charges: "Bank and carrier charges",
  other: "Other",
};

/**
 * How one commission row is bucketed (the database's tax_category_totals says the same): held money
 * (or a reversal of it) is not income and is left out (null); a reversal maps as the type it corrects
 * — a reversed advance reduces gross receipts, a reversed chargeback reduces returns; one that names
 * nothing goes by its sign: money back is gross receipts, money out follows the mapping for "reversal".
 */
export function commissionTaxKey(entryType: string, correctsType: string | null, amountCents: number): { sourceValue: string; forced: TaxCategory | null } | null {
  if ((correctsType ?? entryType) === "held") return null;
  if (entryType === "reversal" && correctsType) return { sourceValue: correctsType, forced: null };
  if (entryType === "reversal" && amountCents > 0) return { sourceValue: "reversal", forced: "gross_receipts" };
  return { sourceValue: entryType, forced: null };
}

export const TIN_TYPES = ["ein", "ssn", "foreign", "none"] as const;
export const ENTITY_TYPES = ["individual", "sole_prop", "llc", "corp", "foreign"] as const;
export const EXEMPT_REASONS = ["corporation", "foreign", "employee"] as const;
export type ExemptReason = (typeof EXEMPT_REASONS)[number];
export const EXEMPT_LABELS: Record<ExemptReason, string> = { corporation: "Corporation", foreign: "Foreign payee", employee: "Employee (W-2)" };

/** A tax ID as the screen shows it by default: the type and the last four only. */
export function maskTaxId(type: string, last4: string | null): string {
  if (!last4) return "—";
  return `${type === "ssn" ? "SSN" : type === "ein" ? "EIN" : "ID"} ••••${last4}`;
}

/** Digits (and letters, for a foreign ID) only; an EIN or SSN must be nine digits. */
export function normaliseTaxId(type: string, raw: string): { value: string; last4: string } | { error: string } {
  const value = raw.replace(/[^0-9A-Za-z]/g, "");
  if ((type === "ein" || type === "ssn") && !/^\d{9}$/.test(value)) return { error: `An ${type.toUpperCase()} is nine digits.` };
  if (type === "foreign" && (value.length < 4 || value.length > 30)) return { error: "Enter the foreign tax ID as issued." };
  return { value, last4: value.slice(-4) };
}

export type Payee = { payeeType: "partner" | "producer" | "vendor"; payeeId: string; displayName: string; paidCents: number; profile: { legalName: string | null; taxIdType: string; taxIdLast4: string | null; w9OnFile: boolean; exemptReason: ExemptReason | null } | null };

/**
 * The year's contractor list: who needs a 1099 (over the threshold and not exempt), who is under it
 * (excluded, counted), who is exempt (shown with the reason) — and the actionable line: requiring a
 * 1099 but missing a W-9 or a tax ID.
 */
export function contractorReport<P extends Payee>(payees: P[], thresholdCents: number) {
  const rows = payees.map((p) => {
    const exempt = p.profile?.exemptReason ?? null;
    const over = p.paidCents >= thresholdCents;
    const requires = over && !exempt;
    const missing: string[] = [];
    if (requires && !p.profile?.w9OnFile) missing.push("W-9");
    if (requires && !p.profile?.taxIdLast4) missing.push("tax ID");
    if (requires && !p.profile?.legalName) missing.push("legal name");
    return { ...p, nameOnForm: p.profile?.legalName ?? p.displayName, exempt, over, requires, missing };
  }).sort((a, b) => b.paidCents - a.paidCents);
  return {
    rows: rows.filter((r) => r.over || r.exempt),
    under: rows.filter((r) => !r.over && !r.exempt),
    requiringCount: rows.filter((r) => r.requires).length,
    missingCount: rows.filter((r) => r.requires && r.missing.length > 0).length,
    thresholdCents,
  };
}
