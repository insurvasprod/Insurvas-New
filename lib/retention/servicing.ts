/**
 * LA-5.4 (Notion sprint) · servicing requests, as plain rules: the four kinds of change, the fields
 * each one changes (what the next carrier file has to show), and the steps a person may take.
 * Whether a change HAPPENED is never decided here: verify_servicing_requests decides it from the file.
 *
 * Pure; relative imports only.
 */

import type { FixAction, PaymentMethod } from "./constants.ts";

export const REQUEST_TYPES = ["draft_date_change", "payment_method_change", "bill_to_draft_conversion", "address_change"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_LABELS: Record<RequestType, string> = {
  draft_date_change: "Payment date",
  payment_method_change: "Bank or card details",
  bill_to_draft_conversion: "Paper bill → bank payment",
  address_change: "Address",
};

export const STATUSES = ["draft", "submitted", "awaiting_carrier", "confirmed_by_carrier", "verified_in_file", "failed", "cancelled"] as const;
export type RequestStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Not sent yet",
  submitted: "Sent to the carrier",
  awaiting_carrier: "Carrier is working on it",
  confirmed_by_carrier: "Carrier says done",
  verified_in_file: "Verified in the file",
  failed: "Not in the file",
  cancelled: "Cancelled",
};
export const OPEN_STATUSES: readonly RequestStatus[] = ["draft", "submitted", "awaiting_carrier", "confirmed_by_carrier"];
/** Sent, and waiting for a file to prove it. */
export const WAITING_STATUSES: readonly RequestStatus[] = ["submitted", "awaiting_carrier", "confirmed_by_carrier"];

export const CARRIER_METHODS = ["portal", "phone", "form", "email"] as const;
export type CarrierMethod = (typeof CARRIER_METHODS)[number];
export const CARRIER_METHOD_LABELS: Record<CarrierMethod, string> = { portal: "Carrier portal", phone: "Phone call", form: "Signed form", email: "Email" };

export const ORIGINS = ["save_queue", "retention_board", "client_request", "campaign"] as const;
export type Origin = (typeof ORIGINS)[number];

/** The steps a person takes by hand. Verified and failed are the file's alone. */
export const NEXT_STEPS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["awaiting_carrier", "confirmed_by_carrier", "cancelled"],
  awaiting_carrier: ["confirmed_by_carrier", "cancelled"],
  confirmed_by_carrier: ["cancelled"],
  verified_in_file: [],
  failed: [],
  cancelled: [],
};
export const canStep = (from: RequestStatus, to: RequestStatus) => NEXT_STEPS[from].includes(to);

/** The save-queue fix each kind of request carries out (LA-5.3 → 5.4). A call-only fix has none. */
export const REQUEST_FOR_FIX: Partial<Record<FixAction, RequestType>> = {
  move_draft_date: "draft_date_change",
  convert_to_draft: "bill_to_draft_conversion",
  confirm_account: "payment_method_change",
};

/** Fields the carrier file can carry, and how a reason names them. A field outside this list can never be proven. */
export const FIELD_LABELS: Record<string, string> = {
  draft_day: "draft day",
  payment_method: "payment method",
  bank_account_last4: "account ending",
  insured_address: "address",
  insured_zip: "ZIP",
  insured_state: "state",
};

export type FieldChange = { field: string; from: string | null; to: string };

export type RequestInput =
  | { type: "draft_date_change"; currentDraftDay: number | null; targetDraftDay: number }
  | { type: "payment_method_change"; currentMethod: PaymentMethod | null; toMethod: PaymentMethod | null; accountLast4: string | null }
  | { type: "bill_to_draft_conversion"; targetDraftDay: number | null }
  | { type: "address_change"; address: string | null; zip: string | null; state: string | null };

export class ServicingRuleError extends Error {}

/** The field changes a request records: what the next file has to show. */
export function fieldChanges(input: RequestInput): FieldChange[] {
  switch (input.type) {
    case "draft_date_change": {
      if (!Number.isInteger(input.targetDraftDay) || input.targetDraftDay < 1 || input.targetDraftDay > 28) throw new ServicingRuleError("Pick a draft day between the 1st and the 28th.");
      if (input.currentDraftDay === input.targetDraftDay) throw new ServicingRuleError("That is already the draft day.");
      return [{ field: "draft_day", from: input.currentDraftDay === null ? null : String(input.currentDraftDay), to: String(input.targetDraftDay) }];
    }
    case "payment_method_change": {
      const out: FieldChange[] = [];
      if (input.toMethod && input.toMethod !== input.currentMethod) out.push({ field: "payment_method", from: input.currentMethod, to: input.toMethod });
      if (input.accountLast4 !== null) {
        if (!/^\d{4}$/.test(input.accountLast4)) throw new ServicingRuleError("Give the last four digits of the new account or card, nothing more.");
        out.push({ field: "bank_account_last4", from: null, to: input.accountLast4 });
      }
      if (!out.length) throw new ServicingRuleError("Say what changes: a new way to pay, or the new account's last four digits.");
      return out;
    }
    case "bill_to_draft_conversion": {
      const out: FieldChange[] = [{ field: "payment_method", from: "direct_bill", to: "bank_draft" }];
      if (input.targetDraftDay !== null) {
        if (!Number.isInteger(input.targetDraftDay) || input.targetDraftDay < 1 || input.targetDraftDay > 28) throw new ServicingRuleError("Pick a draft day between the 1st and the 28th.");
        out.push({ field: "draft_day", from: null, to: String(input.targetDraftDay) });
      }
      return out;
    }
    case "address_change": {
      const out: FieldChange[] = [];
      const clean = (v: string | null) => (v ?? "").trim().replace(/\s+/g, " ");
      if (clean(input.address)) out.push({ field: "insured_address", from: null, to: clean(input.address).slice(0, 300) });
      if (clean(input.zip)) {
        if (!/^\d{5}(-\d{4})?$/.test(clean(input.zip))) throw new ServicingRuleError("A ZIP is five digits.");
        out.push({ field: "insured_zip", from: null, to: clean(input.zip) });
      }
      if (clean(input.state)) {
        if (!/^[A-Za-z]{2}$/.test(clean(input.state))) throw new ServicingRuleError("A state is its two-letter code.");
        out.push({ field: "insured_state", from: null, to: clean(input.state).toUpperCase() });
      }
      if (!out.length) throw new ServicingRuleError("Give the new address.");
      return out;
    }
  }
}

/** "Draft day 3 → 22" — how a change reads on a row. */
export function describeChange(c: FieldChange): string {
  const label = FIELD_LABELS[c.field] ?? c.field.replace(/_/g, " ");
  const show = (v: string | null) => (v === null ? null : c.field === "payment_method" ? v.replace(/_/g, " ") : v);
  const from = show(c.from);
  return from === null ? `${label[0].toUpperCase()}${label.slice(1)} → ${show(c.to)}` : `${label[0].toUpperCase()}${label.slice(1)} ${from} → ${show(c.to)}`;
}

/** Why a request is waiting: the file has nothing to show for these fields. */
export function unprovableText(fields: string[], carrierName: string): string | null {
  if (!fields.length) return null;
  const names = fields.map((f) => FIELD_LABELS[f] ?? f.replace(/_/g, " "));
  return `${carrierName}'s file doesn't show the ${names.join(" or the ")}, so this can't be verified from it.`;
}
