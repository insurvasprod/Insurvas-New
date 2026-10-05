/**
 * LA-4.8 · persistency: of the policies old enough to be judged, how many were still alive N months
 * after they were issued. Carriers watch month 9; below about 65% an agent can lose the contract.
 *
 *   · the denominator for month N is every policy issued at least N months before today that is not
 *     pending (a pending policy was never issued);
 *   · the numerator is those not lapsed or cancelled before issue + N months. A policy that lapsed
 *     on exactly that day did not make it; one that lapsed the day after did;
 *   · months are calendar months, clamped to the month's last day (31 Jan + 1 = 28/29 Feb), the
 *     same arithmetic the ledger dates chargebacks with;
 *   · a cohort too young to count is left out, never counted as alive;
 *   · a group with fewer than MIN_COHORT policies shows no percentage, because three policies do
 *     not make a rate.
 *
 * Pure (no I/O), tested in compute.test.mjs.
 */
import { addMonths } from "../ledger/compute.ts";

export const PERSISTENCY_MONTHS = [3, 6, 9, 13] as const;
export type PersistencyMonth = (typeof PERSISTENCY_MONTHS)[number];
/** The month carriers judge an agent on, and the line below which a contract is at risk. */
export const TARGET_MONTH: PersistencyMonth = 9;
export const TARGET_RATE = 0.65;
/** Fewer policies than this in a cell, and the cell shows "—". */
export const MIN_COHORT = 5;

export type PersistencyPolicy = {
  id: string;
  status: string;
  /** Issue date, YYYY-MM-DD. */
  effectiveDate: string;
  /** When a lapsed or cancelled policy was marked so (YYYY-MM-DD or a timestamp); null otherwise. */
  endedOn: string | null;
  carrier: string;
  leadSource: string;
};

export type PersistencyCell = { month: PersistencyMonth; eligible: number; alive: number; rate: number | null };
export type PersistencyRow = { key: string; label: string; policies: number; cells: PersistencyCell[] };

/** Whether one policy counts for month N, and whether it was alive then. */
export function judge(policy: PersistencyPolicy, month: number, today: string): { eligible: boolean; alive: boolean } {
  if (policy.status === "pending") return { eligible: false, alive: false };
  const mark = addMonths(policy.effectiveDate.slice(0, 10), month);
  if (mark > today) return { eligible: false, alive: false };
  const ended = policy.status === "lapsed" || policy.status === "cancelled";
  const endedOn = ended ? (policy.endedOn ?? today).slice(0, 10) : null;
  return { eligible: true, alive: !endedOn || endedOn > mark };
}

function cellsFor(policies: PersistencyPolicy[], today: string): PersistencyCell[] {
  return PERSISTENCY_MONTHS.map((month) => {
    let eligible = 0;
    let alive = 0;
    for (const policy of policies) {
      const verdict = judge(policy, month, today);
      if (!verdict.eligible) continue;
      eligible += 1;
      if (verdict.alive) alive += 1;
    }
    return { month, eligible, alive, rate: eligible >= MIN_COHORT ? alive / eligible : null };
  });
}

function groupBy(policies: PersistencyPolicy[], keyOf: (policy: PersistencyPolicy) => string, today: string): PersistencyRow[] {
  const groups = new Map<string, PersistencyPolicy[]>();
  for (const policy of policies) groups.set(keyOf(policy), [...(groups.get(keyOf(policy)) ?? []), policy]);
  return [...groups.entries()]
    .map(([label, members]) => ({ key: label, label, policies: members.length, cells: cellsFor(members, today) }))
    .sort((a, b) => b.policies - a.policies || a.label.localeCompare(b.label));
}

export type PersistencyReport = {
  overall: PersistencyCell[];
  byCarrier: PersistencyRow[];
  byLeadSource: PersistencyRow[];
  /** The month-9 figure against the target, for the headline. */
  target: { month: PersistencyMonth; rate: number | null; eligible: number; below: boolean | null };
  policies: number;
};

export function computePersistency(policies: PersistencyPolicy[], today: string): PersistencyReport {
  const issued = policies.filter((policy) => policy.status !== "pending");
  const overall = cellsFor(issued, today);
  const at = overall.find((cell) => cell.month === TARGET_MONTH) as PersistencyCell;
  return {
    overall,
    byCarrier: groupBy(issued, (policy) => policy.carrier, today),
    byLeadSource: groupBy(issued, (policy) => policy.leadSource, today),
    target: { month: TARGET_MONTH, rate: at.rate, eligible: at.eligible, below: at.rate === null ? null : at.rate < TARGET_RATE },
    policies: issued.length,
  };
}
