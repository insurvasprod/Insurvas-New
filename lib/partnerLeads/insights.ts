import { HELD_STATUSES, SALE_DISPOSITIONS } from "./lanes.ts";
import type { PartnerLeadRow } from "./types.ts";

/**
 * What the Team performance board says in words, worked out from the leads it already holds.
 *
 * A figure on a dashboard only helps when it points at a decision, so this turns the rows into
 * sentences a partner admin can act on: what has waited too long, where leads do and do not turn
 * into applications, and when and from whom they arrive. Every rule has a floor on how many leads
 * it needs before it speaks, because a "conversion rate" over two leads ranks people on noise.
 */

/** An unclaimed lead older than this is one the agency has not picked up in time. */
export const UNCLAIMED_AFTER_HOURS = 48;
/** A claimed lead whose record has not changed for this long is stalled. */
export const STALLED_AFTER_DAYS = 7;
/** Leads a product needs before its conversion is compared with the team's. */
export const MIN_PRODUCT_SAMPLE = 5;
/** Leads the period needs before a best day or a top submitter is named. */
export const MIN_PATTERN_SAMPLE = 8;
/** Percentage points a product must sit from the team's rate to be worth a sentence. */
const GAP_POINTS = 5;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type InsightTone = "action" | "watch" | "info";
export type Insight = { key: string; tone: InsightTone; text: string; href?: string; hrefLabel?: string };

export function isSold(row: Pick<PartnerLeadRow, "status" | "disposition">): boolean {
  return row.status === "completed" && row.disposition !== null && (SALE_DISPOSITIONS as readonly string[]).includes(row.disposition);
}

export function isHeld(row: Pick<PartnerLeadRow, "status">): boolean {
  return (HELD_STATUSES as readonly string[]).includes(row.status);
}

export type ProductLine = { product: string; leads: number; applications: number; conversion: number | null };

/** One line per product, the busiest first. Conversion is null under the sample floor. */
export function productBreakdown(rows: readonly PartnerLeadRow[]): ProductLine[] {
  const map = new Map<string, { leads: number; applications: number }>();
  for (const row of rows) {
    const name = row.product?.trim() || "Unspecified";
    const line = map.get(name) ?? { leads: 0, applications: 0 };
    line.leads += 1;
    if (isSold(row)) line.applications += 1;
    map.set(name, line);
  }
  return [...map.entries()]
    .map(([product, line]) => ({ product, ...line, conversion: line.leads >= MIN_PRODUCT_SAMPLE ? (line.applications / line.leads) * 100 : null }))
    .sort((a, b) => b.leads - a.leads || a.product.localeCompare(b.product));
}

/** Leads per weekday, Monday first, in the viewer's own calendar. */
export function weekdayCounts(rows: readonly PartnerLeadRow[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    const date = new Date(row.submittedAt);
    if (Number.isNaN(date.getTime())) continue;
    counts[(date.getDay() + 6) % 7] += 1;
  }
  return counts;
}

export type Where = { waiting: number; inProgress: number; closed: number; applications: number };

/** Where the period's leads are now: not picked up, with a closer, closed without a sale, or sold. */
export function whereLeadsAre(rows: readonly PartnerLeadRow[]): Where {
  const where: Where = { waiting: 0, inProgress: 0, closed: 0, applications: 0 };
  for (const row of rows) {
    if (isSold(row)) where.applications += 1;
    else if (row.status === "unclaimed") where.waiting += 1;
    else if (isHeld(row)) where.inProgress += 1;
    else where.closed += 1;
  }
  return where;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const pct = (value: number) => `${Math.round(value)}%`;

export function buildInsights(rows: readonly PartnerLeadRow[], now: number): Insight[] {
  const out: Insight[] = [];

  const unclaimed = rows.filter((row) => row.status === "unclaimed" && now - Date.parse(row.submittedAt) >= UNCLAIMED_AFTER_HOURS * HOUR_MS);
  if (unclaimed.length) {
    out.push({
      key: "unclaimed",
      tone: "action",
      text: `${unclaimed.length} ${plural(unclaimed.length, "lead has", "leads have")} waited over ${UNCLAIMED_AFTER_HOURS / 24} days for an agent to pick ${plural(unclaimed.length, "it", "them")} up.`,
      href: "/partner/pipeline",
      hrefLabel: "Open pipeline",
    });
  }

  const stalled = rows.filter((row) => isHeld(row) && now - Date.parse(row.updatedAt) >= STALLED_AFTER_DAYS * DAY_MS);
  if (stalled.length) {
    out.push({
      key: "stalled",
      tone: "watch",
      text: `${stalled.length} claimed ${plural(stalled.length, "lead has", "leads have")} not moved in ${STALLED_AFTER_DAYS}+ days.`,
      href: "/partner/pipeline",
      hrefLabel: "Review",
    });
  }

  const sold = rows.filter(isSold).length;
  const lines = productBreakdown(rows).filter((line) => line.conversion !== null);
  if (rows.length >= MIN_PRODUCT_SAMPLE && lines.length > 1) {
    const team = (sold / rows.length) * 100;
    const worst = [...lines].sort((a, b) => a.conversion! - b.conversion!)[0];
    const best = [...lines].sort((a, b) => b.conversion! - a.conversion!)[0];
    if (worst.conversion! < team - GAP_POINTS) {
      out.push({ key: "product-low", tone: "watch", text: `${worst.product} converts ${pct(worst.conversion!)} against ${pct(team)} for the whole team.` });
    }
    if (best.product !== worst.product && best.conversion! > team + GAP_POINTS) {
      out.push({ key: "product-high", tone: "info", text: `${best.product} converts best: ${pct(best.conversion!)} (${best.applications} of ${best.leads}).` });
    }
  } else if (rows.length > 0 && lines.length === 0) {
    out.push({ key: "product-sample", tone: "info", text: `Conversion by product shows once a product has ${MIN_PRODUCT_SAMPLE} leads.` });
  }

  if (rows.length >= MIN_PATTERN_SAMPLE) {
    const counts = weekdayCounts(rows);
    const top = counts.indexOf(Math.max(...counts));
    const share = counts[top] / rows.length;
    if (share >= 0.25) out.push({ key: "weekday", tone: "info", text: `${WEEKDAYS[top]}s bring ${pct(share * 100)} of your leads.` });

    const bySubmitter = new Map<string, { name: string; count: number }>();
    for (const row of rows) {
      const id = row.submittedBy.id ?? row.submittedBy.name;
      const line = bySubmitter.get(id) ?? { name: row.submittedBy.name, count: 0 };
      line.count += 1;
      bySubmitter.set(id, line);
    }
    if (bySubmitter.size > 1) {
      const lead = [...bySubmitter.values()].sort((a, b) => b.count - a.count)[0];
      if (lead.count / rows.length >= 0.5) out.push({ key: "submitter", tone: "info", text: `${lead.name} submitted ${pct((lead.count / rows.length) * 100)} of the leads.` });
    }
  }

  const order: Record<InsightTone, number> = { action: 0, watch: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
