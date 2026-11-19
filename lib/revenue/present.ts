// Admin › Billing › Revenue (admin round 1, billing-r2 screen 11): the period switch, the cohort table and the CSV
// export. Pure, so the period's arithmetic, the cohort rule and the CSV quoting are tested without a database.

import { csvCellMinimal } from "../csv/cell.ts";

export type RevenuePeriod = "30" | "90" | "12m";

export const REVENUE_PERIODS: ReadonlyArray<{ key: RevenuePeriod; label: string; days: number; short: string }> = [
  { key: "30", label: "30 days", days: 30, short: "30 days" },
  { key: "90", label: "90 days", days: 90, short: "90 days" },
  { key: "12m", label: "12 months", days: 365, short: "12 months" },
];

/** `?period=` as a period; anything else is the 30-day default the page always had. */
export function revenuePeriod(value: string | string[] | undefined): (typeof REVENUE_PERIODS)[number] {
  const key = Array.isArray(value) ? value[0] : value;
  return REVENUE_PERIODS.find((p) => p.key === key) ?? REVENUE_PERIODS[0];
}

export type CohortSubscription = { started_at: string; cancelled_at: string | null; status: string };

export type CohortRow = {
  /** "2026-06". */
  month: string;
  started: number;
  /** Share still paying after each offset in COHORT_OFFSETS; null when that point has not come yet. */
  retained: Array<number | null>;
};

export const COHORT_OFFSETS = [1, 2, 3, 6] as const;

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()));
}

/**
 * Cohort retention from the subscriptions' own dates (Notion §12): the subscriptions that started in each month, and
 * the share of them still running 1, 2, 3 and 6 months after each one's start. A subscription is running at a moment
 * when it had started and had not been cancelled by then. One still in its trial has not paid yet, so it joins no
 * cohort; a point that lies in the future for any member of the cohort is left blank rather than guessed.
 */
export function cohortTable(subscriptions: readonly CohortSubscription[], now: Date, months = 6): CohortRow[] {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const byMonth = new Map<string, CohortSubscription[]>();
  for (const s of subscriptions) {
    if (s.status === "trialing") continue;
    const start = new Date(s.started_at);
    if (Number.isNaN(start.getTime()) || start < first || start > now) continue;
    const key = s.started_at.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), s]);
  }
  const rows: CohortRow[] = [];
  for (let i = 0; i < months; i += 1) {
    const monthStart = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    const key = monthStart.toISOString().slice(0, 7);
    const members = byMonth.get(key) ?? [];
    rows.push({
      month: key,
      started: members.length,
      retained: COHORT_OFFSETS.map((offset) => {
        if (members.length === 0) return null;
        const at = members.map((m) => addMonths(new Date(m.started_at), offset));
        if (at.some((moment) => moment > now)) return null;
        const still = members.filter((m, index) => !m.cancelled_at || new Date(m.cancelled_at) > at[index]).length;
        return still / members.length;
      }),
    });
  }
  return rows;
}

/** One CSV field: the product's one escaper (lib/csv/cell.ts), quoting only when needed. */
const field = csvCellMinimal;

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(field).join(",")).join("\r\n") + "\r\n";
}
