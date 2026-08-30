// SA-3.2 · Turning what we know about a plan into invoice lines.
//
// Pure and dependency-free so it is unit-tested directly. Everything here is integer cents; the
// only place a decimal appears is at the provider boundary, in lib/payments/whop/client.ts.

import type { InvoiceLineInput } from "./constants.ts";

export type PlanForInvoice = {
  name: string;
  version: number;
  billingCycle: string;
  priceCents: number;
  setupFeeCents: number;
};

export type BuildLinesOptions = {
  /**
   * True on the first payment of a subscription. A setup fee is charged once, so billing it on
   * every renewal is the obvious way to overcharge a long-standing customer.
   */
  isFirstPeriod: boolean;
};

export function buildInvoiceLines(plan: PlanForInvoice, options: BuildLinesOptions): InvoiceLineInput[] {
  const lines: InvoiceLineInput[] = [
    {
      kind: "plan",
      label: `${plan.name} v${plan.version} — ${plan.billingCycle}`,
      quantity: 1,
      unit_cents: plan.priceCents,
      amount_cents: plan.priceCents,
    },
  ];

  if (options.isFirstPeriod && plan.setupFeeCents > 0) {
    lines.push({
      kind: "setup_fee",
      label: "Setup fee",
      quantity: 1,
      unit_cents: plan.setupFeeCents,
      amount_cents: plan.setupFeeCents,
    });
  }

  return lines;
}

/** What the lines add up to, with discounts and credits subtracting. Mirrors the SQL exactly. */
export function totalCents(lines: InvoiceLineInput[]): number {
  return lines.reduce((sum, line) => {
    const isCredit = line.kind === "discount" || line.kind === "credit";
    return isCredit ? sum - Math.abs(line.amount_cents) : sum + line.amount_cents;
  }, 0);
}
