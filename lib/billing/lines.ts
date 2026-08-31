// Assembling the lines of a period invoice: add-ons, overage, proration, credit.
//
// Backlog #41, #44 and #46 were three symptoms of one absence — the pieces existed and nothing
// joined them. This is the joining, and it is deliberately pure: no database, no provider, no
// clock. Every number that reaches a customer's invoice is computed here, so every number that
// reaches a customer's invoice is unit-tested.
//
// Integer cents throughout, like the rest of the money code. A float here would be a rounding
// error on somebody's bill.

import type { InvoiceLineInput, InvoiceLineKind } from "@/lib/invoices/constants";
import type { BillingCycle } from "@/lib/money";

/** One meter's usage for a period, as `admin_usage_monitor` reports it. */
export type MeterUsage = {
  meterKey: string;
  label: string;
  unit: string;
  usedQty: number;
  /** Effective allowance including any credit grants. Null means unlimited. */
  includedQty: number | null;
  /** A hard-capped meter cannot be exceeded, so it cannot produce overage. */
  hardCap: boolean;
};

/** What a meter costs to sell, from `meter_pricing`. */
export type MeterPrice = {
  meterKey: string;
  sellCents: number;
};

export type AttachedAddonForBilling = {
  code: string;
  name: string;
  priceCents: number;
  billingCycle: BillingCycle;
};

export type PendingChargeForBilling = {
  id: string;
  kind: InvoiceLineKind;
  label: string;
  quantity: number;
  includedQty: number | null;
  unitCents: number;
  amountCents: number;
};

export type AssembledPeriodInvoice = {
  lines: InvoiceLineInput[];
  /** Everything that is not a discount or a credit. */
  subtotalCents: number;
  /** Credit actually spent — never more than the subtotal. */
  creditAppliedCents: number;
  /** subtotal − credit. Zero or less means no invoice is raised. */
  totalCents: number;
  /** Pending charge ids that made it onto the invoice, for the caller to settle. */
  pendingIds: string[];
};

/**
 * Overage for one period.
 *
 * Three ways a meter produces no overage line, and each is a deliberate decision rather than an
 * oversight:
 *
 *   unlimited allowance   nothing to exceed
 *   hard-capped           usage was refused at the door, so exceeding it is not possible; billing
 *                         for it would mean charging for something we blocked
 *   no sell price         an operator has not priced the meter, and inventing a price to bill a
 *                         customer is worse than billing nothing. Configuration Center flags these
 *                         as unpriced.
 */
export function overageLines(usage: MeterUsage[], pricing: MeterPrice[]): InvoiceLineInput[] {
  const priceOf = new Map(pricing.map((p) => [p.meterKey, p.sellCents]));

  return usage
    .filter((m) => m.includedQty !== null && !m.hardCap && m.usedQty > m.includedQty)
    .map((m) => {
      const over = m.usedQty - (m.includedQty as number);
      const unit = priceOf.get(m.meterKey) ?? 0;
      return { meter: m, over, unit };
    })
    .filter(({ unit }) => unit > 0)
    .map(({ meter, over, unit }) => ({
      kind: "overage" as const,
      // The allowance is named in the label as well as carried in included_qty, because the
      // customer reading the PDF should be able to check the arithmetic without asking us.
      label: `${meter.label} — ${over.toLocaleString()} ${meter.unit} over the ${(meter.includedQty as number).toLocaleString()} included`,
      quantity: over,
      included_qty: meter.includedQty as number,
      unit_cents: unit,
      amount_cents: over * unit,
    }));
}

/**
 * Add-ons attached to the subscription.
 *
 * Only add-ons billed on the subscription's own cycle appear. A yearly add-on on a monthly
 * subscription is not billed monthly — it is billed on the period whose cycle matches, and until
 * mixed cycles are actually supported, quietly billing it every month would be the expensive kind
 * of wrong. It is skipped and reported rather than guessed at.
 */
export function addonLines(
  addons: AttachedAddonForBilling[],
  cycle: BillingCycle,
): { lines: InvoiceLineInput[]; skipped: AttachedAddonForBilling[] } {
  const lines: InvoiceLineInput[] = [];
  const skipped: AttachedAddonForBilling[] = [];

  for (const addon of addons) {
    if (addon.billingCycle !== cycle) {
      skipped.push(addon);
      continue;
    }
    if (addon.priceCents <= 0) continue;
    lines.push({
      kind: "addon",
      label: addon.name,
      quantity: 1,
      unit_cents: addon.priceCents,
      amount_cents: addon.priceCents,
    });
  }

  return { lines, skipped };
}

/**
 * Charges parked by an earlier event — a mid-period upgrade above all.
 *
 * A proration is two rows, not one: the unused value of the old plan and the cost of the new one.
 * They are kept apart all the way to the invoice because a single "$122.58 plan change" line is
 * unarguable-with, and a customer who can see $152.61 credited and $275.19 charged can check it.
 */
export function pendingChargeLines(pending: PendingChargeForBilling[]): InvoiceLineInput[] {
  return pending.map((p) => ({
    kind: p.kind,
    label: p.label,
    quantity: p.quantity,
    ...(p.includedQty !== null ? { included_qty: p.includedQty } : {}),
    unit_cents: p.unitCents,
    amount_cents: p.amountCents,
  }));
}

/**
 * How much of a credit balance this invoice can absorb.
 *
 * Clamped to the subtotal, deliberately. A credit larger than the bill must not produce a negative
 * invoice — we would be issuing a demand for money we owe them, which is not what an invoice is —
 * and it must not silently evaporate either. The remainder stays on the balance for next period.
 */
export function creditApplied(balanceCents: number, subtotalCents: number): number {
  if (balanceCents <= 0 || subtotalCents <= 0) return 0;
  return Math.min(balanceCents, subtotalCents);
}

/** A credit line carries a POSITIVE amount and subtracts, matching create_custom_invoice. */
export function creditLine(appliedCents: number): InvoiceLineInput | null {
  if (appliedCents <= 0) return null;
  return {
    kind: "credit",
    label: "Account credit applied",
    quantity: 1,
    unit_cents: appliedCents,
    amount_cents: appliedCents,
  };
}

function isReduction(kind: InvoiceLineKind): boolean {
  return kind === "discount" || kind === "credit";
}

/**
 * The whole assembly, in the order the lines appear on the document.
 *
 * Order is not cosmetic: proration first because it explains a change the customer just made,
 * add-ons next because they are the predictable part, overage after because it is the part that
 * varies, and credit last because it applies to everything above it.
 */
export function assemblePeriodInvoice(input: {
  pending: PendingChargeForBilling[];
  addons: AttachedAddonForBilling[];
  cycle: BillingCycle;
  usage: MeterUsage[];
  pricing: MeterPrice[];
  creditBalanceCents: number;
}): AssembledPeriodInvoice & { skippedAddons: AttachedAddonForBilling[] } {
  const fromPending = pendingChargeLines(input.pending);
  const { lines: fromAddons, skipped } = addonLines(input.addons, input.cycle);
  const fromOverage = overageLines(input.usage, input.pricing);

  const charges = [...fromPending, ...fromAddons, ...fromOverage];

  // A pending charge may itself be a credit (a downgrade's unused value), so the subtotal has to
  // respect line kind rather than assume everything above the credit line is a charge.
  const subtotalCents = charges
    .filter((l) => !isReduction(l.kind))
    .reduce((sum, l) => sum + l.amount_cents, 0);

  const pendingReductions = charges
    .filter((l) => isReduction(l.kind))
    .reduce((sum, l) => sum + Math.abs(l.amount_cents), 0);

  const netBeforeCredit = subtotalCents - pendingReductions;
  const creditAppliedCents = creditApplied(input.creditBalanceCents, netBeforeCredit);
  const credit = creditLine(creditAppliedCents);

  return {
    lines: credit ? [...charges, credit] : charges,
    subtotalCents,
    creditAppliedCents,
    totalCents: netBeforeCredit - creditAppliedCents,
    pendingIds: input.pending.map((p) => p.id),
    skippedAddons: skipped,
  };
}
