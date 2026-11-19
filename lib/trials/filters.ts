// The admin Trials list's filters, read from and written to the address (billing-r2 screen 3), so the workspace's
// "Trials ending, no card" lands filtered (`?ends=week&card=no_card`). Pure: the page, the list and the test agree.

import { csvOf } from "../subscriptionsList/filters.ts";

export type TrialEndsFilter = "any" | "soon" | "week";
export type TrialSignalFilter = "any" | "no_leads" | "no_team" | "no_carrier" | "neither";
export type TrialCardFilter = "any" | "card" | "no_card";
export type TrialFilters = { q: string; plan: string; ends: TrialEndsFilter; signal: TrialSignalFilter; card: TrialCardFilter };

/** The row fields the filters, the search and the export read. */
export type TrialFilterRow = {
  subscriptionId: string;
  tenantId: string;
  displayName: string;
  tenantName: string;
  planName: string;
  ownerEmail: string | null;
  ownerName: string | null;
  daysLeft: number;
  hasPaymentMethod: boolean;
  signals: Record<"leads" | "team" | "carrier", boolean> | null;
};

const ENDS: readonly string[] = ["soon", "week"];
const SIGNALS: readonly string[] = ["no_leads", "no_team", "no_carrier", "neither"];
const CARDS: readonly string[] = ["card", "no_card"];

type Params = Record<string, string | string[] | undefined> | URLSearchParams;
function one(params: Params, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

export function readTrialFilters(params: Params): TrialFilters {
  const ends = one(params, "ends");
  const signal = one(params, "signal");
  const card = one(params, "card");
  return {
    q: one(params, "q").slice(0, 120),
    plan: one(params, "plan") || "all",
    ends: ENDS.includes(ends) ? (ends as TrialEndsFilter) : "any",
    signal: SIGNALS.includes(signal) ? (signal as TrialSignalFilter) : "any",
    card: CARDS.includes(card) ? (card as TrialCardFilter) : "any",
  };
}

export function trialFilterParams(filters: TrialFilters): Record<string, string | null> {
  return {
    q: filters.q || null,
    plan: filters.plan === "all" ? null : filters.plan,
    ends: filters.ends === "any" ? null : filters.ends,
    signal: filters.signal === "any" ? null : filters.signal,
    card: filters.card === "any" ? null : filters.card,
  };
}

/** `soonDays` is ENDING_SOON_DAYS (3): the "Ends within 3 days" choice. */
export function filterTrials<T extends TrialFilterRow>(rows: readonly T[], filters: TrialFilters, soonDays: number): T[] {
  const needle = filters.q.toLowerCase();
  return rows.filter((row) => {
    if (filters.plan !== "all" && row.planName !== filters.plan) return false;
    if (filters.ends === "soon" && row.daysLeft > soonDays) return false;
    if (filters.ends === "week" && row.daysLeft > 7) return false;
    if (filters.card === "card" && !row.hasPaymentMethod) return false;
    if (filters.card === "no_card" && row.hasPaymentMethod) return false;
    if (filters.signal !== "any") {
      if (!row.signals) return false;
      if (filters.signal === "no_leads" && row.signals.leads) return false;
      if (filters.signal === "no_team" && row.signals.team) return false;
      if (filters.signal === "no_carrier" && row.signals.carrier) return false;
      if (filters.signal === "neither" && (row.signals.leads || row.signals.team)) return false;
    }
    if (!needle) return true;
    return [row.displayName, row.tenantName, row.ownerEmail ?? "", row.ownerName ?? ""].some((value) => value.toLowerCase().includes(needle));
  });
}

export function trialsCsv(rows: readonly (TrialFilterRow & { startedAt: string; trialEndsAt: string; billingCycle: string; engagement: { label: string } })[]): string {
  const yes = (value: boolean | undefined | null) => (value === undefined || value === null ? "" : value ? "yes" : "no");
  return csvOf(
    ["Customer", "Customer id", "Plan", "Billing", "Started", "Ends", "Days left", "Owner", "Owner email", "Owner sign-in", "Card on file", "Imported leads", "Second user", "Carrier added"],
    rows.map((row) => [
      row.displayName, row.tenantId, row.planName, row.billingCycle, row.startedAt, row.trialEndsAt, row.daysLeft, row.ownerName, row.ownerEmail, row.engagement.label,
      yes(row.hasPaymentMethod), yes(row.signals?.leads), yes(row.signals?.team), yes(row.signals?.carrier),
    ]),
  );
}
