/**
 * LA-7.4 (Notion sprint, Module 7 — Accounting) · payout statements, with no database.
 *
 * Two readers, two shapes. The agency sees every item. The partner sees its own statement through
 * an explicit whitelist (partnerStatement) — never another partner's anything, and transfers rejected
 * at the compliance gate as a COUNT with no detail: the list would be a product a call centre could
 * resell.
 *
 * Owner, 2026-11-06 (partner payouts rework): a Model B partner is paid a share of the commission on its
 * own policies, and its invoice shows the math — the commission each share was taken from, policy by
 * policy. That is the one commission figure a partner reads, and only on its own policies.
 */

export const ITEM_TYPES = ["submitted_application", "transfer", "lead", "sale", "issued_policy", "revenue_share", "clawback", "carried_balance", "rejected", "credit", "dispute", "adjustment"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_LABELS: Record<ItemType, string> = {
  submitted_application: "Applications submitted",
  transfer: "Accepted transfers",
  lead: "Leads submitted",
  sale: "Sales",
  issued_policy: "Issued policies",
  revenue_share: "Revenue share",
  clawback: "Chargebacks taken back",
  carried_balance: "Balance from an earlier invoice",
  rejected: "Rejected — compliance",
  credit: "Credits accepted",
  dispute: "Disputed",
  adjustment: "Adjustments",
};

export type RunStatus = "draft" | "published" | "paid" | "void";
export const RUN_STATUS_LABELS: Record<RunStatus, string> = { draft: "Draft", published: "Published", paid: "Paid", void: "Void" };

export type RunItem = {
  id: string; itemType: ItemType; sourceId: string | null; occurredOn: string; rateAppliedCents: number | null; ratePctBp: number | null; amountCents: number; note: string | null;
  /** From the ledger entry (20261106110000), when the item came from one: the commission a share was taken from, and whose policy. */
  basisCents?: number | null; clientName?: string | null; policyNumber?: string | null; carrier?: string | null;
};
export type RunDispute = { id: string; itemId: string | null; side: "agent" | "partner"; reason: string; claimCents: number; status: "open" | "accepted" | "upheld" | "void"; resolutionNote: string | null; raisedAt: string; resolvedAt: string | null; carriedToRunId: string | null };
export type RunHeader = { id: string; partnerId: string; periodStart: string; periodEnd: string; status: RunStatus; grossCents: number; deductionsCents: number; disputedCents: number; netCents: number; paidOn: string | null; publishedAt: string | null; footer: string | null; invoiceNumber?: string | null; hasPdf?: boolean };

/** The items paid at a flat rate each. */
const PER_UNIT = new Set<ItemType>(["submitted_application", "transfer", "lead", "sale", "issued_policy"]);

/** One statement line per item type and rate: "Accepted transfers 63 @ $90". */
export type StatementLine = { itemType: ItemType; label: string; count: number; rateCents: number | null; amountCents: number };

export function statementLines(items: RunItem[]): StatementLine[] {
  const groups = new Map<string, StatementLine>();
  for (const i of items) {
    const rate = PER_UNIT.has(i.itemType) ? i.rateAppliedCents : null;
    const key = `${i.itemType}|${rate ?? ""}`;
    const line = groups.get(key) ?? { itemType: i.itemType, label: ITEM_LABELS[i.itemType], count: 0, rateCents: rate, amountCents: 0 };
    line.count += 1;
    line.amountCents += i.amountCents;
    groups.set(key, line);
  }
  return [...groups.values()].sort((a, b) => ITEM_TYPES.indexOf(a.itemType) - ITEM_TYPES.indexOf(b.itemType) || (a.rateCents ?? 0) - (b.rateCents ?? 0));
}

/** The disputed lines withheld from net, as the statement shows them: one per dispute, with its reason. */
export function disputedLines(disputes: RunDispute[]) {
  return disputes.filter((d) => d.side === "agent").map((d) => ({ reason: d.reason, amountCents: -d.claimCents, status: d.status }));
}

const short = (id: string | null) => (id ? id.slice(0, 8) : null);

/**
 * What a partner may read of a run: published or paid only (the caller has already checked the run
 * is theirs). Billable items carry a date, the rate and the client or a short reference; a commission
 * share carries its policy and the commission it was taken from (owner, 2026-11-06); rejected
 * transfers are a count.
 */
export function partnerStatement(run: RunHeader, items: RunItem[], disputes: RunDispute[]) {
  if (run.status !== "published" && run.status !== "paid") return null;
  const billable = items.filter((i) => PER_UNIT.has(i.itemType) || i.itemType === "adjustment" || i.itemType === "clawback" || i.itemType === "carried_balance");
  const revenue = items.filter((i) => i.itemType === "revenue_share");
  const credits = items.filter((i) => i.itemType === "credit");
  return {
    id: run.id,
    invoiceNumber: run.invoiceNumber ?? null,
    hasPdf: Boolean(run.hasPdf),
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    status: run.status as "published" | "paid",
    paidOn: run.paidOn,
    publishedAt: run.publishedAt,
    footer: run.footer,
    totals: { grossCents: run.grossCents, deductionsCents: run.deductionsCents, disputedCents: run.disputedCents, netCents: run.netCents },
    lines: statementLines(billable).map((l) => ({ label: l.label, count: l.count, rateCents: l.rateCents, amountCents: l.amountCents })),
    revenueShare: revenue.length ? {
      amountCents: revenue.reduce((s, i) => s + i.amountCents, 0),
      policies: revenue.map((i) => ({ occurredOn: i.occurredOn, clientName: i.clientName ?? null, policyNumber: i.policyNumber ?? null, carrier: i.carrier ?? null, commissionCents: i.basisCents ?? null, ratePctBp: i.ratePctBp, amountCents: i.amountCents })),
    } : null,
    rejectedCount: items.filter((i) => i.itemType === "rejected").length,
    credits: { count: credits.length, amountCents: credits.reduce((s, i) => s + i.amountCents, 0) },
    items: billable.map((i) => ({ id: i.id, label: ITEM_LABELS[i.itemType], occurredOn: i.occurredOn, rateCents: i.rateAppliedCents, amountCents: i.amountCents, reference: i.clientName ?? short(i.sourceId), disputed: disputes.some((d) => d.itemId === i.id) })),
    disputes: disputes.map((d) => ({ id: d.id, raisedBy: d.side === "partner" ? "you" : "the agency", reason: d.reason, amountCents: d.claimCents, status: d.status, resolutionNote: d.resolutionNote, raisedAt: d.raisedAt, resolvedAt: d.resolvedAt })),
  };
}

/** What the partner reads; `from` (LA-8.3) is the agency's trading name and address, added by the store. */
export type PartnerStatement = NonNullable<ReturnType<typeof partnerStatement>> & { from?: { name: string | null; addressLines: string[] } };
