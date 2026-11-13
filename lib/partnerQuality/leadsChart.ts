// The chart view of a partner's leads behind a figure (/app/partner-quality/[partnerId]/leads?show=chart,
// owner 2026-11-12: the Table · Chart switch on every Reports sub-page). Pure arithmetic over the rows the
// page's own query returns (/api/app/partner-quality/leads): no other source, nothing estimated.
import { datesBetween } from "./metrics";

export type LeadsChartPoint = { key: string; label: string; from: string; to: string; value: number };
export type LeadsChartGroup = { key: string | null; value: number; submitted: number };

/** Up to this many days the line is one point a day; longer periods are one point a reporting week (Mon–Sun). */
export const LEADS_CHART_DAILY_MAX = 45;

const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Leads received over [from, to], oldest first, with empty days or weeks kept so the line is honest about gaps.
 * A week is clipped to the period, so its `from`/`to` are exactly the leads it counts.
 */
export function leadsOverTime(leads: readonly { date: string }[], from: string, to: string): { unit: "day" | "week"; points: LeadsChartPoint[] } {
  const days = datesBetween(from, to).reverse();
  const unit = days.length <= LEADS_CHART_DAILY_MAX ? "day" : "week";
  const points: LeadsChartPoint[] = [];
  if (unit === "day") {
    for (const day of days) points.push({ key: day, label: DAY_LABEL.format(new Date(`${day}T00:00:00Z`)), from: day, to: day, value: 0 });
  } else {
    const weekday = new Date(`${from}T00:00:00Z`).getUTCDay();
    for (let monday = shiftDate(from, -((weekday + 6) % 7)); monday <= to && points.length < 120; monday = shiftDate(monday, 7)) {
      const sunday = shiftDate(monday, 6);
      points.push({ key: monday, label: DAY_LABEL.format(new Date(`${monday}T00:00:00Z`)), from: monday < from ? from : monday, to: sunday > to ? to : sunday, value: 0 });
    }
  }
  for (const lead of leads) {
    const point = points.find((entry) => lead.date >= entry.from && lead.date <= entry.to);
    if (point) point.value += 1;
  }
  return { unit, points };
}

/** Leads by one field (a disposition, a state), largest first; a missing value is its own group, last. */
export function leadsBy<T extends { submitted: boolean }>(leads: readonly T[], field: (lead: T) => string | null | undefined): LeadsChartGroup[] {
  const groups = new Map<string | null, LeadsChartGroup>();
  for (const lead of leads) {
    const raw = field(lead);
    const key = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    const group = groups.get(key) ?? { key, value: 0, submitted: 0 };
    group.value += 1;
    if (lead.submitted) group.submitted += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || b.value - a.value || String(a.key).localeCompare(String(b.key)));
}
