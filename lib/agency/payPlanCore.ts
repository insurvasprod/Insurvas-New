/**
 * Team payouts (owner's Accounting doc, "Team Payouts", round 1 boards T1–T7, 2026-11-07), with no database
 * (client-safe). The three ways to share the commission, the plan form's rules, and the draft's arithmetic —
 * the same arithmetic agency_payout_commit applies (20261107100000), so the draft the owner reviews is the run
 * that is confirmed. Integer cents and basis points only.
 */

export const PAY_MODELS = ["solo_owner", "sidekick", "salary_bonus", "big_split", "contract_level"] as const;
export type PayModel = (typeof PAY_MODELS)[number];

export const PAY_MODEL_LABELS: Record<PayModel, string> = {
  solo_owner: "Owner",
  sidekick: "Sidekick",
  salary_bonus: "Salary + bonus",
  big_split: "Big split",
  contract_level: "Contract level",
};

/** The three cards on the form; model 1 has two roles. */
export const PAY_MODEL_CARDS = [
  { key: "1", title: "Owner or sidekick", hint: "The owner keeps 100%. A sidekick (retention) gets a flat amount for each deal they save." },
  { key: "2", title: "Salary + bonus", hint: "A fixed monthly amount, a small slice of their sales, and a bonus per submitted application." },
  { key: "3", title: "Big split", hint: "No salary. A straight split of the commission, and chargebacks come back at the same split." },
  { key: "0", title: "As before: contract level", hint: "No plan. Their share follows their contract level against the agency's, as before plans existed." },
] as const;

/** What a model starts with when it is picked on the form (owner's examples). The person can change any of them. */
export const MODEL_STARTERS: Record<"sidekick" | "salary_bonus" | "big_split", { base: string; pct: string; bonus: string; fee: string }> = {
  sidekick: { base: "0.00", pct: "", bonus: "0.00", fee: "20.00" },
  salary_bonus: { base: "500.00", pct: "10", bonus: "25.00", fee: "0.00" },
  big_split: { base: "0.00", pct: "70", bonus: "0.00", fee: "0.00" },
};

export const cardOf = (model: PayModel): "0" | "1" | "2" | "3" => (model === "contract_level" ? "0" : model === "salary_bonus" ? "2" : model === "big_split" ? "3" : "1");

export type PayPlan = {
  model: PayModel;
  baseCents: number;
  salesPctBp: number | null;
  appBonusCents: number;
  saveFeeCents: number;
  chargebacksApply: boolean;
  effectiveFrom: string;
};

/** The plan's deal in one line, as the Pay plans list shows it. */
export function planSummary(p: PayPlan): string {
  if (p.model === "contract_level") return "Paid by contract level, as before";
  if (p.model === "solo_owner") return "Keeps 100% of commission";
  if (p.model === "sidekick") return `${dollarsOf(p.saveFeeCents)} per saved deal`;
  if (p.model === "salary_bonus") {
    return [`${dollarsOf(p.baseCents)} a month`, `${pctOf(p.salesPctBp ?? 0)} of their sales`, p.appBonusCents ? `${dollarsOf(p.appBonusCents)} per submitted app` : null].filter(Boolean).join(" · ");
  }
  const agent = p.salesPctBp ?? 0;
  return `Agent ${pctOf(agent)} / agency ${pctOf(10000 - agent)}`;
}

export function chargebackSummary(p: PayPlan): string {
  if (p.model === "contract_level") return "At their level";
  if (p.model === "solo_owner" || p.model === "sidekick") return "n/a";
  if (p.model === "big_split") return `Pays back ${pctOf(p.salesPctBp ?? 0)}`;
  return p.chargebacksApply ? `Pays back ${pctOf(p.salesPctBp ?? 0)}` : "Off · agency absorbs";
}

/** What the form may save: the same shape the database checks (producer_pay_plan_shape). */
export function planProblem(p: PayPlan): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveFrom)) return "Choose the date the plan starts.";
  const money = [p.baseCents, p.appBonusCents, p.saveFeeCents];
  if (money.some((c) => !Number.isInteger(c) || c < 0)) return "Amounts can't be negative.";
  if (p.salesPctBp !== null && (!Number.isInteger(p.salesPctBp) || p.salesPctBp < 0 || p.salesPctBp > 10000)) return "A share is between 0% and 100%.";
  if (p.model === "sidekick" && p.saveFeeCents <= 0) return "Enter what a saved deal pays.";
  if (p.model === "salary_bonus" && p.salesPctBp === null) return "Enter their share of the commission on their own sales (0% is fine).";
  if (p.model === "salary_bonus" && p.baseCents === 0 && p.appBonusCents === 0 && p.salesPctBp === 0) return "Salary + bonus needs a base, a share or a bonus.";
  if (p.model === "big_split" && !p.salesPctBp) return "Enter the agent's share of the split.";
  return null;
}

/** The row the database stores for a model: fields that don't belong to it are cleared, not kept. */
export function normalizePlan(p: PayPlan): PayPlan {
  if (p.model === "solo_owner" || p.model === "contract_level") return { ...p, baseCents: 0, salesPctBp: null, appBonusCents: 0, saveFeeCents: 0, chargebacksApply: true };
  if (p.model === "sidekick") return { ...p, baseCents: 0, salesPctBp: null, appBonusCents: 0, chargebacksApply: true };
  if (p.model === "salary_bonus") return { ...p, saveFeeCents: 0 };
  return { ...p, baseCents: 0, appBonusCents: 0, saveFeeCents: 0, chargebacksApply: true };
}

// ─── the draft ────────────────────────────────────────────────────────────────────────────────────

export const BALANCE_CHOICES = ["withhold", "recover", "forgive"] as const;
export type BalanceChoice = (typeof BALANCE_CHOICES)[number];
export type RunMode = "pay_full" | BalanceChoice;

/** Settings' rule for anyone below zero → the draft's default choice. */
export function defaultChoice(policy: string | null | undefined): BalanceChoice {
  return policy === "cap" ? "recover" : policy === "write_off" ? "forgive" : "withhold";
}

export type DraftInput = {
  /** What was owed before the month (negative = they owe the agency). */
  beforeCents: number;
  /** The month: commission share + salary + bonuses + fees − chargebacks. */
  periodCents: number;
};

export type DraftPay = { payCents: number; takenCents: number; forgivenCents: number; afterCents: number };

/** One person's pay for the month, by the owner's choice. Mirrors agency_payout_commit. */
export function draftPay(x: DraftInput, mode: RunMode, pctBp = 2000): DraftPay {
  const { beforeCents: b, periodCents: p } = x;
  if (mode === "pay_full") { const pay = Math.max(p, 0); return { payCents: pay, takenCents: 0, forgivenCents: 0, afterCents: b + p - pay }; }
  if (mode === "withhold") { const pay = Math.max(b + p, 0); return { payCents: pay, takenCents: Math.max(Math.max(p, 0) - pay, 0), forgivenCents: 0, afterCents: b + p - pay }; }
  if (mode === "recover") {
    const debt = Math.max(-b, 0);
    const take = Math.min(debt, bpShare(debt, pctBp), Math.max(p, 0));
    const pay = Math.max(p - take, 0);
    return { payCents: pay, takenCents: take, forgivenCents: 0, afterCents: b + p - pay };
  }
  const forgiven = Math.max(-(b + Math.min(p, 0)), 0);
  const before = b + forgiven;
  const pay = Math.max(Math.min(p, before + p), 0);
  return { payCents: pay, takenCents: 0, forgivenCents: forgiven, afterCents: before + p - pay };
}

/** cents × bp / 10000, half away from zero, integers only (bp_share in SQL). */
export function bpShare(cents: number, bp: number): number {
  const sign = cents < 0 ? -1 : 1;
  const a = Math.abs(cents) * bp;
  return sign * Math.floor((a * 2 + 10000) / 20000);
}

/** The month a run covers: first and last day, from "YYYY-MM". */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function previousMonth(today: string): string {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export const PAY_METHODS = ["Bank transfer", "Zelle", "Check", "Other"] as const;

// ─── formatting (strings, no float) ───────────────────────────────────────────────────────────────

export function pctOf(bp: number): string {
  const d = String(Math.abs(bp)).padStart(3, "0");
  const frac = d.slice(-2).replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${d.slice(0, -2)}${frac ? `.${frac}` : ""}%`;
}

/** "70", "70%", "12.5" → basis points; null when it isn't a percent. */
export function parsePctToBp(input: string): number | null {
  const m = input.trim().replace(/%$/, "").trim().match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bp <= 10000 ? bp : null;
}

function dollarsOf(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  return `${cents < 0 ? "-" : ""}$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(rest).padStart(2, "0")}`;
}
