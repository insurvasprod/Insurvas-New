import type { FactsSettings, FilesFacts } from "@/components/app/book/setup/carrier-facts";
import type { WindowItem, WindowRow, WindowRule } from "@/components/app/book/setup/carrier-terms-window-dialog";
import { RULE_TYPE_LABELS, RULE_TYPES, type ResolvedRule, type RuleRow, type RuleType, type SettingField } from "@/lib/ingestion/carrierRules";
import type { CarrierCoverage } from "@/lib/pipelineRules/carrierCoverage";
import { carrierRulesHref, gapCost } from "@/lib/pipelineRules/carrierCoverageModel";

/**
 * Setup › Carrier terms, shared by the grid and a carrier's page: a carrier's coverage as the rows the client screens
 * draw. Server-side and pure (only types come from the client components, so nothing here is a client reference).
 */

export const TERMS_HREF = "/app/book-setup/carrier-rules";

/** The (i) beside the title: today's "About carrier terms" text, for the grid. */
export const TERMS_INFO = "Each carrier's windows: how long it waits for the first payment, the grace after a missed one, when a lapsed policy can still come back, and how it pays and sends files. Without a window, Insurvas can't count down to a lapse or a chargeback for that carrier. Work across the grid: a cell opens that window; set it from the carrier's contract or its agent guide.";

/** Board 1·6: the database-update state, inside the table. */
export const PENDING_TITLE = "Carrier terms need a database update";
export const PENDING_HINT = "20261008150000. Until then nothing can be set here.";

export const MONEY_FACTS = ["commissionTrigger", "expectedLagDays", "minimumPayoutCents", "toleranceCents"] as const satisfies readonly SettingField[];

const toWindow = (rule: ResolvedRule | RuleRow | null): WindowRule | null =>
  rule ? { id: rule.id, scope: rule.tenantId ? "agency" : "platform", windowDays: rule.windowDays, graceDays: rule.graceDays, redraftAttempts: rule.redraftAttempts, redraftIntervalDays: rule.redraftIntervalDays, source: rule.source, notes: rule.notes, effectiveFrom: rule.effectiveFrom, verified: Boolean(rule.verifiedAt) } : null;

/** The five windows in RULE_TYPES order: the rule in force, Insurvas's, the agency's upcoming one, and the cost of a gap. */
export function windowRows(carrier: CarrierCoverage): WindowRow[] {
  return RULE_TYPES.map((type) => {
    const rule = carrier.rules[type];
    return { type, state: rule.state, rule: toWindow(rule.inForce), insurvas: toWindow(rule.insurvas), upcoming: toWindow(rule.upcoming), cost: gapCost(type, carrier.inForce) };
  });
}

/** The money and file facts with whose each value is. */
export function factsOf(carrier: CarrierCoverage): { settings: FactsSettings; files: FilesFacts } {
  const settings = Object.fromEntries(Object.entries(carrier.settings).map(([field, s]) => [field, { value: s.value, scope: s.scope, since: s.since, yours: s.yours, insurvas: s.insurvas }])) as FactsSettings;
  return { settings, files: { layouts: carrier.layouts, portal: carrier.portal, guidance: carrier.guidance, referencePattern: carrier.referencePattern } };
}

/** Every missing window, the costliest first: the carriers come sorted by policies affected, the windows in order. */
export function missingQueue(carriers: CarrierCoverage[]): WindowItem[] {
  return carriers.flatMap((carrier) => windowRows(carrier).filter((row) => row.state === "missing").map((row) => ({ carrierId: carrier.carrierId, carrierName: carrier.carrierName, row })));
}

/** A carrier's page on one of its tabs. */
export const carrierTabHref = (carrierId: string, tab: string) => `${carrierRulesHref(carrierId)}${tab === "windows" ? "" : `?tab=${tab}`}`;

/** Policies with this carrier, in force: what an In force figure opens. */
export const policiesHref = (carrierId: string) => `/app/policies?carrier=${carrierId}&show=inforce`;

export const windowName = (type: RuleType) => RULE_TYPE_LABELS[type].label;

const TRIGGER: Record<string, string> = { on_issue: "On issue", on_first_draft: "On first draft" };
export const triggerText = (value: string | number | null) => (value === null ? null : TRIGGER[String(value)] ?? String(value));
