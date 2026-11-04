/**
 * Setup › Carrier rules, the coverage screen (LA-4.17; boards 9, 9b of docs/la4/mockups-r5/book-commissions-r5.html):
 * one carrier, one row, everything about it. Per carrier, each of the five windows is verified, observed but
 * unverified, or not set; the biggest gap is named in words with the in-force policies it leaves without a
 * countdown; the list sorts the costliest gap first.
 *
 * Null means null: a window that is not set reads "not set", never a guessed default. The rule in force is the
 * agency's own, then Insurvas's, then nothing (resolveRule). Pure; relative imports only, so the test runs it.
 */
import { RULE_TYPE_LABELS, RULE_TYPES, resolveRule, type ResolvedRule, type RuleRow, type RuleType } from "../ingestion/carrierRules.ts";

/** A carrier's own rules page (board 9b), inside the Setup frame. */
export const carrierRulesHref = (carrierId: string) => `/app/book-setup/carrier-rules/${carrierId}`;

export type DotState ="verified" | "unverified" | "missing";

export type CoverageRule = {
  type: RuleType;
  state: DotState;
  /** The rule in force today: the agency's own, else Insurvas's, else null. */
  inForce: ResolvedRule | null;
  /** Insurvas's rule on its own, so "Back to Insurvas's" can say what it returns to. */
  insurvas: RuleRow | null;
  /** The agency's own rule dated after today, so a person sees it is coming. */
  upcoming: RuleRow | null;
  /** Every row for this carrier and window, both scopes, newest first: past countdowns keep the one they used. */
  history: RuleRow[];
};

export type Gap = { type: RuleType; policies: number; words: string; cost: string };

/** A window is set when a rule is in force and it gives the days the carrier allows. */
export function ruleState(rule: ResolvedRule | null): DotState {
  if (!rule || rule.windowDays === null) return "missing";
  return rule.verified ? "verified" : "unverified";
}

export function coverageRules(rows: RuleRow[], input: { tenantId: string; carrierId: string; asOf: string }): Record<RuleType, CoverageRule> {
  const mine = rows.filter((row) => row.carrierId === input.carrierId);
  return Object.fromEntries(RULE_TYPES.map((type) => {
    const ofType = mine.filter((row) => row.ruleType === type);
    const inForce = resolveRule(ofType, { tenantId: input.tenantId, carrierId: input.carrierId, ruleType: type, asOf: input.asOf });
    const insurvas = resolveRule(ofType.filter((row) => row.tenantId === null), { tenantId: null, carrierId: input.carrierId, ruleType: type, asOf: input.asOf });
    const upcoming = ofType.filter((row) => row.tenantId === input.tenantId && row.effectiveFrom > input.asOf && !row.cleared).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] ?? null;
    const history = [...ofType].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt));
    return [type, { type, state: ruleState(inForce), inForce, insurvas, upcoming, history }];
  })) as Record<RuleType, CoverageRule>;
}

const policies = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "policy" : "policies"}`;

/** What a missing window costs, as the coverage screen says it ("112 policies can't be counted down"). */
export function gapCost(type: RuleType, inForce: number): string {
  if (inForce === 0) return "no policies in force today";
  return `${policies(inForce)} in force ${inForce === 1 ? "has" : "have"} no ${RULE_TYPE_LABELS[type].label.toLowerCase()} countdown`;
}

/** Each window a carrier has no days for, in the order they matter (first payment first). */
export function coverageGapsOf(rules: Record<RuleType, CoverageRule>, inForce: number): Gap[] {
  return RULE_TYPES.filter((type) => rules[type].state === "missing").map((type) => ({
    type,
    policies: inForce,
    words: `${RULE_TYPE_LABELS[type].label} window not set`,
    cost: gapCost(type, inForce),
  }));
}

export type CoverageRow = { carrierId: string; carrierName: string; inForce: number; rules: Record<RuleType, CoverageRule> };

export const missingOf = (row: CoverageRow) => RULE_TYPES.filter((type) => row.rules[type].state === "missing");
export const unverifiedOf = (row: CoverageRow) => RULE_TYPES.filter((type) => row.rules[type].state === "unverified");

/** The policies the carrier's gaps leave without a countdown: its in-force book when any window is missing. */
export const affectedBy = (row: CoverageRow) => (missingOf(row).length ? row.inForce : 0);

/** The costliest gap first, then the carrier missing most, then the bigger book, then by name. */
export function sortByAffected<T extends CoverageRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => affectedBy(b) - affectedBy(a) || missingOf(b).length - missingOf(a).length || b.inForce - a.inForce || a.carrierName.localeCompare(b.carrierName));
}

export type CoverageFilter = "all" | "missing" | "unverified";

export function filterCoverage<T extends CoverageRow>(rows: T[], filter: CoverageFilter, query: string): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => (filter === "all" || (filter === "missing" ? missingOf(row).length > 0 : unverifiedOf(row).length > 0)) && (!q || row.carrierName.toLowerCase().includes(q)));
}

/** The Carrier rules tab's count: every window missing, across the agency's carriers. */
export const missingRuleCount = (rows: CoverageRow[]) => rows.reduce((sum, row) => sum + missingOf(row).length, 0);

const TRIGGER: Record<string, string> = { on_issue: "On issue", on_first_draft: "On first draft" };
const FORMAT: Record<string, string> = { spreadsheet: "Spreadsheet", pdf: "PDF" };

/** The list's Money cell: the pay trigger and lag, or which is not set. Nothing guessed. */
export function moneySummary(trigger: string | null, lagDays: number | null): string {
  if (trigger === null && lagDays === null) return "Trigger and lag not set";
  if (trigger === null) return `Trigger not set · ${lagDays} d`;
  if (lagDays === null) return `${TRIGGER[trigger] ?? trigger} · lag not set`;
  return `${TRIGGER[trigger] ?? trigger} · ${lagDays} d`;
}

/** The list's Files cell: the statement format and the layout its files are read with. */
export function filesSummary(format: string | null, layoutVersion: number | null): string {
  const layout = layoutVersion === null ? "no layout yet" : `layout v${layoutVersion}`;
  return `${format === null ? "Format not set" : FORMAT[format] ?? format} · ${layout}`;
}
