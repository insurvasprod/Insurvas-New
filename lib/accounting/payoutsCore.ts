/**
 * LA-7.4 (Notion sprint, Module 7 — Accounting) · payout statements, with no database.
 *
 * Two readers, two shapes. The agency sees every item. The partner sees its own statement through
 * an explicit whitelist (partnerStatement) — never another partner's anything, never a commission
 * figure (revenue share is one total, never the per-policy commission it was taken from), and
 * transfers rejected at the compliance gate as a COUNT with no detail: the list would be a product
 * a call centre could resell.
 */

export const ITEM_TYPES = ["transfer", "lead", "sale", "issued_policy", "revenue_share", "rejected", "credit", "dispute", "adjustment"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_LABELS: Record<ItemType, string> = {
  transfer: "Accepted transfers",
  lead: "Leads submitted",
  sale: "Sales",
  issued_policy: "Issued policies",
  revenue_share: "Revenue share",
  rejected: "Rejected — compliance",
  credit: "Credits accepted",
  dispute: "Disputed",
  adjustment: "Adjustments",
};

export type RunStatus = "draft" | "published" | "paid" | "void";
export const RUN_STATUS_LABELS: Record<RunStatus, string> = { draft: "Draft", published: "Published", paid: "Paid", void: "Void" };

export type RunItem = { id: string; itemType: ItemType; sourceId: string | null; occurredOn: string; rateAppliedCents: number | null; ratePctBp: number | null; amountCents: number; note: string | null };
export type RunDispute = { id: string; itemId: string | null; side: "agent" | "partner"; reason: string; claimCents: number; status: "open" | "accepted" | "upheld" | "void"; resolutionNote: string | null; raisedAt: string; resolvedAt: string | null; carriedToRunId: string | null };
export type RunHeader = { id: string; partnerId: string; periodStart: string; periodEnd: string; status: RunStatus; grossCents: number; deductionsCents: number; disputedCents: number; netCents: number; paidOn: string | null; publishedAt: string | null; footer: string | null };

/** One statement line per item type and rate: "Accepted transfers 63 @ $90". */
export type StatementLine = { itemType: ItemType; label: string; count: number; rateCents: number | null; amountCents: number };

export function statementLines(items: RunItem[]): StatementLine[] {
  const groups = new Map<string, StatementLine>();
  for (const i of items) {
    const rate = i.itemType === "transfer" || i.itemType === "lead" || i.itemType === "sale" || i.itemType === "issued_policy" ? i.rateAppliedCents : null;
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
 * is theirs). Billable items carry a date, the rate and a short reference to their own submission;
 * revenue share and rejected transfers are aggregated; nothing names a commission amount.
 */
export function partnerStatement(run: RunHeader, items: RunItem[], disputes: RunDispute[]) {
  if (run.status !== "published" && run.status !== "paid") return null;
  const billable = items.filter((i) => i.itemType === "transfer" || i.itemType === "lead" || i.itemType === "sale" || i.itemType === "issued_policy" || i.itemType === "adjustment");
  const revenue = items.filter((i) => i.itemType === "revenue_share");
  const credits = items.filter((i) => i.itemType === "credit");
  return {
    id: run.id,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    status: run.status as "published" | "paid",
    paidOn: run.paidOn,
    publishedAt: run.publishedAt,
    footer: run.footer,
    totals: { grossCents: run.grossCents, deductionsCents: run.deductionsCents, disputedCents: run.disputedCents, netCents: run.netCents },
    lines: statementLines(billable).map((l) => ({ label: l.label, count: l.count, rateCents: l.rateCents, amountCents: l.amountCents })),
    revenueShare: revenue.length ? { amountCents: revenue.reduce((s, i) => s + i.amountCents, 0) } : null,
    rejectedCount: items.filter((i) => i.itemType === "rejected").length,
    credits: { count: credits.length, amountCents: credits.reduce((s, i) => s + i.amountCents, 0) },
    items: billable.map((i) => ({ id: i.id, label: ITEM_LABELS[i.itemType], occurredOn: i.occurredOn, rateCents: i.rateAppliedCents, amountCents: i.amountCents, reference: short(i.sourceId), disputed: disputes.some((d) => d.itemId === i.id) })),
    disputes: disputes.map((d) => ({ id: d.id, raisedBy: d.side === "partner" ? "you" : "the agency", reason: d.reason, amountCents: d.claimCents, status: d.status, resolutionNote: d.resolutionNote, raisedAt: d.raisedAt, resolvedAt: d.resolvedAt })),
  };
}

/** What the partner reads; `from` (LA-8.3) is the agency's trading name and address, added by the store. */
export type PartnerStatement = NonNullable<ReturnType<typeof partnerStatement>> & { from?: { name: string | null; addressLines: string[] } };
