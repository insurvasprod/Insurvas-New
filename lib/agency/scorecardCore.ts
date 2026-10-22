/**
 * AG-1.9 (Notion sprint, Agency Module 0 / AG-1) · producer scorecards — GROUP, do not recompute. No database.
 *
 * Every figure is an existing engine's, grouped by producer:
 *   placement, persistency      LA-4.18's scorecard engine (lib/ingestion/scorecards.ts: issued, placed, persistency)
 *   cost per issued / persisting LA-7's (lib/accounting/pnlCore.ts: perPolicy, persisting, chargebackTax)
 * What is new here is only the producer dimension, and one rule the spec adds:
 *   LEAD COST FOLLOWS ASSIGNMENT, not authorship. A lead assigned to Dev that Maria closed still cost Dev's
 *   pipeline; attributing it to Maria would make Dev's cost per sale look free. allocateLeadCost splits each
 *   campaign's spend across the producers it was assigned to, by lead count, in integer cents, no cent lost.
 * Small-sample rule per producer and period: under the threshold a count ("14/16"), never a percentage.
 */

export type Assignment = { campaignId: string; producerUserId: string };

/**
 * Splits each campaign's spend (positive cents) over the leads ASSIGNED from it, per producer. Each producer gets
 * floor(spend × his leads ÷ all leads); the cents left over go to the producers with the largest remainders, so the
 * parts add back to the campaign's spend exactly.
 */
export function allocateLeadCost(spendByCampaign: ReadonlyMap<string, number>, assignments: readonly Assignment[]): Map<string, number> {
  const out = new Map<string, number>();
  const byCampaign = new Map<string, Map<string, number>>();
  for (const a of assignments) {
    const counts = byCampaign.get(a.campaignId) ?? new Map<string, number>();
    counts.set(a.producerUserId, (counts.get(a.producerUserId) ?? 0) + 1);
    byCampaign.set(a.campaignId, counts);
  }
  for (const [campaign, spend] of spendByCampaign) {
    const counts = byCampaign.get(campaign);
    if (!counts || spend <= 0) continue;
    const total = [...counts.values()].reduce((s, n) => s + n, 0);
    const parts = [...counts].map(([producer, n]) => {
      const exact = spend * n;
      return { producer, floor: Math.floor(exact / total), rem: exact % total };
    });
    let left = spend - parts.reduce((s, p) => s + p.floor, 0);
    parts.sort((a, b) => b.rem - a.rem || a.producer.localeCompare(b.producer));
    for (const p of parts) {
      const extra = left > 0 ? 1 : 0;
      left -= extra;
      out.set(p.producer, (out.get(p.producer) ?? 0) + p.floor + extra);
    }
  }
  return out;
}

/** "14/16" under the sample, "88%" at or above it, "—" with nothing. Whole-number percent, integer arithmetic. */
export function countOrPercent(part: number, whole: number, minSample: number): string {
  if (whole === 0) return "—";
  if (whole < minSample) return `${part}/${whole}`;
  return `${Math.floor((200 * part + whole) / (2 * whole))}%`;
}
