/**
 * Commissions › Producer pay and My pay (round 7, docs/la4/mockups-r7/commissions.html 4·A, 4·1, 5·A): the month and
 * the year in the address, and how they read. Pure: no server, no React, so a server page and a client list share it.
 */
import { monthLabel, monthRange, PAY_MODEL_LABELS, pctOf, previousMonth, type PayPlan } from "@/lib/agency/payPlanCore";

export { monthLabel, monthRange };

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ?period=YYYY-MM, or last month (the month a bookkeeper pays). */
export function parsePeriod(asked: string | null | undefined, today = new Date().toISOString().slice(0, 10)): string {
  return asked && PERIOD.test(asked) && asked <= today.slice(0, 7) ? asked : previousMonth(today);
}

/** ?year=YYYY, or this year. */
export function parseYear(asked: string | null | undefined, today = new Date().toISOString().slice(0, 10)): string {
  return asked && /^\d{4}$/.test(asked) && asked <= today.slice(0, 4) && asked >= "2000" ? asked : today.slice(0, 4);
}

/** The last `count` months, newest first, as the month select offers them. */
export function periodOptions(today = new Date().toISOString().slice(0, 10), count = 18): Array<{ value: string; label: string }> {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const value = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    return { value, label: monthLabel(value) };
  });
}

/** "October" from "2026-10". */
export function monthName(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

/** A pay plan in two or three words, as the Pay list names it ("Big split · 70%"). No plan is paid by contract level. */
export function planShort(plan: PayPlan | null | undefined): string {
  if (!plan || plan.model === "contract_level") return "Contract level";
  if (plan.model === "big_split") return `${PAY_MODEL_LABELS.big_split} · ${pctOf(plan.salesPctBp ?? 0)}`;
  if (plan.model === "sidekick") return `${PAY_MODEL_LABELS.sidekick} · $${Math.round(plan.saveFeeCents / 100).toLocaleString("en-US")} per save`;
  return PAY_MODEL_LABELS[plan.model];
}

/** The producer's Money tab, opened from Producer pay for a month (its ‹ › then walk Producer pay's list). */
export const producerPayHref = (producerId: string, period: string, extra?: Record<string, string>) =>
  `/app/producers/${producerId}?${new URLSearchParams({ tab: "money", from: "reconciliation", period, ...extra })}`;
