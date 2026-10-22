/**
 * LA-4.18 (Notion sprint) · the daily summary: what changed, what is at risk, what is worth attention
 * today. It is built from a computed, structured input — every figure in it is in that input, already
 * formatted — and every line links through to the screen behind it.
 *
 * The lines below are written from templates. When an AI provider is chosen, the insights agent
 * (LA-4.19) may write prose from the same input instead, and `checkProse` is the gate it must pass:
 * no figure that is not in the input, and no prediction (that is LA-5). A quiet day says so.
 *
 * Pure.
 */
import { CONTRACT_MONTH, CONTRACT_SHARE_PCT, percentOf, type PersistencyCell } from "./scorecards.ts";

export type SummarySource = {
  date: string;
  /** Policies their carrier's latest policy file (a week old at most) showed lapse, issue, or turn at risk, and still in that status. */
  lapsed: number;
  issued: number;
  atRisk: number;
  /** Chargeback lines recorded since yesterday, and their total (negative cents). */
  chargebacks: { lines: number; cents: number };
  /** Policies with three days or fewer before the carrier closes them. */
  closingSoon: number;
  closingDays: number;
  contract: PersistencyCell | null;
  minSample: number;
};

export type SummaryFact = { id: string; text: string; href: string; figures: Record<string, string> };
export type SummaryInput = { date: string; facts: SummaryFact[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const money = (cents: number) => {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `$${Number(digits.slice(0, -2)).toLocaleString("en-US")}.${digits.slice(-2)}`;
};

/** The facts worth a line today, most urgent first. Nothing notable → no facts. */
export function buildSummary(s: SummarySource): SummaryInput {
  const facts: SummaryFact[] = [];
  if (s.closingSoon > 0) {
    const f = { count: String(s.closingSoon), days: String(s.closingDays) };
    facts.push({ id: "closing", figures: f, href: "/app/lapse-risk", text: `${f.count} ${plural(s.closingSoon, "policy has", "policies have")} ${f.days} days or fewer before the carrier closes ${plural(s.closingSoon, "it", "them")}.` });
  }
  if (s.lapsed > 0) {
    const f = { count: String(s.lapsed) };
    facts.push({ id: "lapsed", figures: f, href: "/app/policies?status=lapsed", text: `${f.count} ${plural(s.lapsed, "policy", "policies")} lapsed in the latest carrier files.` });
  }
  if (s.atRisk > 0) {
    const f = { count: String(s.atRisk) };
    facts.push({ id: "at_risk", figures: f, href: "/app/lapse-risk", text: `${f.count} ${plural(s.atRisk, "policy", "policies")} moved to at risk.` });
  }
  if (s.chargebacks.lines > 0) {
    const f = { count: String(s.chargebacks.lines), amount: money(s.chargebacks.cents) };
    facts.push({ id: "chargebacks", figures: f, href: "/app/ledger", text: `${f.count} ${plural(s.chargebacks.lines, "chargeback was", "chargebacks were")} recorded, ${f.amount} in all.` });
  }
  const c = s.contract;
  if (c && !c.building && c.eligible >= s.minSample && percentOf(c.alive, c.eligible) < CONTRACT_SHARE_PCT) {
    const f = { month: String(CONTRACT_MONTH), share: `${percentOf(c.alive, c.eligible)}%`, line: `${CONTRACT_SHARE_PCT}%`, alive: String(c.alive), eligible: String(c.eligible) };
    facts.push({ id: "contract", figures: f, href: "/app/book-scorecards?view=persistency", text: `Month-${f.month} persistency is ${f.share} (${f.alive} of ${f.eligible}), under the ${f.line} carriers look for.` });
  }
  if (s.issued > 0) {
    const f = { count: String(s.issued) };
    facts.push({ id: "issued", figures: f, href: "/app/policies?status=active", text: `${f.count} ${plural(s.issued, "policy was", "policies were")} newly issued.` });
  }
  return { date: s.date, facts };
}

export const QUIET_DAY = "Nothing notable today.";

const FIGURE = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const PREDICTION = /\b(will|would|likely|unlikely|predict\w*|forecast\w*|expect\w*|probabl\w*|going to|on track|project(ed|ion)s?)\b/i;
const norm = (figure: string) => figure.replaceAll(",", "");

/**
 * Whether prose may be shown for this input: every figure in it is one of the input's figures, and
 * it claims nothing about the future.
 */
export function checkProse(prose: string, input: SummaryInput): { ok: boolean; strayFigures: string[]; prediction: string | null } {
  const allowed = new Set(input.facts.flatMap((fact) => Object.values(fact.figures)).flatMap((value) => (value.match(FIGURE) ?? []).map(norm)));
  const strayFigures = [...new Set((prose.match(FIGURE) ?? []).map(norm).filter((figure) => !allowed.has(figure)))];
  const prediction = prose.match(PREDICTION)?.[0] ?? null;
  return { ok: strayFigures.length === 0 && prediction === null, strayFigures, prediction };
}
