/**
 * LA-5.10 (Notion sprint) · income capture, as plain rules. Optional everywhere — no flow blocks on
 * it — and used for one radar signal (premium as a share of income) and nothing else.
 *
 * Pure; relative imports only.
 */

import type { IncomeType } from "../applications/constants.ts";

export const CONTACT_INCOME_TYPES = ["ssa", "ssi", "pension", "payroll", "va", "mixed", "other"] as const;
export type ContactIncomeType = (typeof CONTACT_INCOME_TYPES)[number];
export const CONTACT_INCOME_TYPE_LABELS: Record<ContactIncomeType, string> = {
  ssa: "Social Security", ssi: "SSI", pension: "Pension", payroll: "Paycheck", va: "VA benefits", mixed: "More than one", other: "Something else",
};

export const INCOME_SOURCES = ["interview", "draft_date_setup", "retention_call", "agent_estimate"] as const;
export type IncomeSource = (typeof INCOME_SOURCES)[number];
export const INCOME_SURFACES = ["interview", "draft_date_setup", "save_queue"] as const;
export type IncomeSurface = (typeof INCOME_SURFACES)[number];
/** Where a stated figure was captured, by the screen it came from. */
export const SOURCE_FOR_SURFACE: Record<IncomeSurface, IncomeSource> = { interview: "interview", draft_date_setup: "draft_date_setup", save_queue: "retention_call" };

/** The interview wording: a reason the client benefits from, not a demand. */
export const INTERVIEW_PROMPT = "Roughly what comes in each month — Social Security, pension, anything else? It helps me find a premium that will still be comfortable in six months.";

/** LA-3.9's income type, as the income record spells it. "None / not known" is no type at all. */
export function incomeTypeFromDraft(t: IncomeType | null | undefined): ContactIncomeType | null {
  if (!t || t === "none") return null;
  if (t === "ssa_ssi") return "mixed";
  return t;
}

export type IncomeInput = { monthlyDollars: string; incomeType: ContactIncomeType | null; householdTotal: boolean; estimate: boolean };
export type IncomeRecord = { monthlyIncomeCents: number; incomeType: ContactIncomeType | null; householdTotal: boolean; source: IncomeSource; confidence: "stated" | "estimated" };

export class IncomeRuleError extends Error {}

/** A typed figure → the record. An agent's estimate is kept, and marked as one (it counts for less). */
export function toRecord(input: IncomeInput, surface: IncomeSurface): IncomeRecord {
  const cleaned = input.monthlyDollars.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new IncomeRuleError("Enter the monthly amount in dollars, like 1,450.");
  const cents = Math.round(Number(cleaned) * 100);
  if (cents <= 0 || cents >= 10_000_000) throw new IncomeRuleError("That doesn't look like a monthly income.");
  if (input.incomeType !== null && !(CONTACT_INCOME_TYPES as readonly string[]).includes(input.incomeType)) throw new IncomeRuleError("Choose where the money comes from.");
  return {
    monthlyIncomeCents: cents,
    incomeType: input.incomeType,
    householdTotal: input.householdTotal,
    source: input.estimate ? "agent_estimate" : SOURCE_FOR_SURFACE[surface],
    confidence: input.estimate ? "estimated" : "stated",
  };
}

/**
 * The coverage line (LA-5.10): how much of the book is scored with an income, and what a figure is
 * worth. A count, a share and the typical impact — the signal's weight in the current weight set.
 */
export function coverageText(known: number, scored: number, affordabilityWeight: number): string {
  if (scored === 0) return "No policy is scored yet.";
  const share = Math.round((known * 100) / scored);
  const without = scored - known;
  const rest = without === 0 ? "Every scored policy has an income." : `${without.toLocaleString("en-US")} ${without === 1 ? "is" : "are"} scored without it.`;
  return `Income known for ${known.toLocaleString("en-US")} of ${scored.toLocaleString("en-US")} policies (${share}%). ${rest} An income typically moves a score by up to ${affordabilityWeight} points.`;
}
