/**
 * The small facts the phone's pay screens name beside a figure (release 3 boards G1, G2, G4), with no database:
 * which month of a policy's life a line landed in ("lapsed in month 4"), how many months a carrier advances
 * ("9 mo advance"), and per person in a payout month their share of the advance, policies and chargebacks
 * ("80% of advance · 14 policies"). Each is read from the ledger and the carrier rules; none is a guess — when the
 * rows disagree (two advance lengths for one carrier, two shares for one person) the fact is left out.
 */

/** The month of a policy's life an entry is dated in: effective 15 Jul, dated 20 Oct → month 4. Null when unknown. */
export function policyMonth(effective: string | null | undefined, on: string | null | undefined): number | null {
  const ok = (d: string | null | undefined): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
  if (!ok(effective) || !ok(on)) return null;
  const months = (Number(on.slice(0, 4)) - Number(effective.slice(0, 4))) * 12 + Number(on.slice(5, 7)) - Number(effective.slice(5, 7)) - (Number(on.slice(8, 10)) < Number(effective.slice(8, 10)) ? 1 : 0);
  return months < 0 ? null : months + 1;
}

/** The one value every row agrees on, else null (no rows, or rows that disagree). */
export function oneValue<T>(values: readonly T[]): T | null {
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}

/** Per carrier, the advance length every one of its rules agrees on (rules that disagree name no length). */
export function advanceMonthsByCarrier(rules: readonly { carrierId: string; advanceMonths: number }[]): Record<string, number> {
  const by = new Map<string, number[]>();
  for (const r of rules) by.set(r.carrierId, [...(by.get(r.carrierId) ?? []), r.advanceMonths]);
  const out: Record<string, number> = {};
  for (const [carrier, months] of by) {
    const one = oneValue(months);
    if (one !== null && one > 0) out[carrier] = one;
  }
  return out;
}

export const CHARGEBACK_TYPES = ["chargeback", "split_chargeback"] as const;
const ADVANCE_TYPES = ["split_advance", "advance_paid", "earned", "split_earned"];

export type TeamFact = { shareBps: number | null; policies: number; chargebacks: number; applications: number };

/** One payout month's facts per person, from that month's reported ledger lines. */
export function teamFacts(rows: readonly { producerUserId: string; entryType: string; policyNumber: string | null; shareBps: number | null }[]): Record<string, TeamFact> {
  const by = new Map<string, typeof rows[number][]>();
  for (const r of rows) by.set(r.producerUserId, [...(by.get(r.producerUserId) ?? []), r]);
  const out: Record<string, TeamFact> = {};
  for (const [who, rs] of by) {
    const policies = new Set(rs.filter((r) => ADVANCE_TYPES.includes(r.entryType) && r.policyNumber).map((r) => r.policyNumber));
    const backs = new Set(rs.filter((r) => (CHARGEBACK_TYPES as readonly string[]).includes(r.entryType) && r.policyNumber).map((r) => r.policyNumber));
    out[who] = {
      shareBps: oneValue(rs.filter((r) => r.entryType === "split_advance" && r.shareBps !== null).map((r) => r.shareBps as number)),
      policies: policies.size,
      chargebacks: backs.size,
      applications: rs.filter((r) => r.entryType === "app_bonus").length,
    };
  }
  return out;
}
