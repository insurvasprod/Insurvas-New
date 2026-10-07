/**
 * LA-4.17 (Notion sprint) · carrier rules: which rule is in force for an agency, the countdown it
 * gives, what is missing, and the carrier's other settings — with no number of its own.
 *
 *   · resolution: the agency's own rule, then the platform's, then NOTHING. "Null means null": there
 *     is no default window, so a carrier with no rule gives no countdown rather than a guess.
 *   · rules are effective-dated: the one in force on a date is the latest effective on or before it
 *     (the newest row of that day). A past action keeps the rule it was measured against.
 *   · an agency can clear its override, which hands the rule back to the platform's.
 *
 * Pure; relative imports only. Nothing in LA-4 may hard-code a window, a grace or a lag — they come
 * from here (pinned by carrierRules.test.mjs).
 */

export const RULE_TYPES = ["first_payment", "ongoing_payment", "reinstatement", "conservation", "cancellation_request"] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_TYPE_LABELS: Record<RuleType, { label: string; window: string }> = {
  first_payment: { label: "First payment", window: "first payment window" },
  ongoing_payment: { label: "Ongoing payment", window: "window after a missed payment" },
  reinstatement: { label: "Reinstatement", window: "reinstatement window" },
  conservation: { label: "Conservation", window: "conservation window" },
  cancellation_request: { label: "Cancellation request", window: "window after a cancellation request" },
};

export const RULE_SOURCES = ["carrier_agreement", "phone_call", "observed"] as const;
export type RuleSource = (typeof RULE_SOURCES)[number];
export const RULE_SOURCE_LABELS: Record<RuleSource, string> = { carrier_agreement: "Carrier agreement", phone_call: "Phone call", observed: "Observed" };

export const COMMISSION_TRIGGERS = ["on_issue", "on_first_draft"] as const;
export const CADENCES = ["daily", "weekly", "monthly", "ad_hoc"] as const;
export const STATEMENT_FORMATS = ["spreadsheet", "pdf"] as const;

export type RuleRow = {
  id: string;
  tenantId: string | null;
  carrierId: string;
  ruleType: RuleType;
  windowDays: number | null;
  graceDays: number | null;
  redraftAttempts: number | null;
  redraftIntervalDays: number | null;
  source: RuleSource | null;
  notes: string | null;
  effectiveFrom: string;
  createdAt: string;
  cleared: boolean;
  verifiedAt: string | null;
};

export type ResolvedRule = RuleRow & { scope: "agency" | "platform"; verified: boolean };

function latest(rows: RuleRow[], asOf: string): RuleRow | null {
  const eligible = rows.filter((row) => row.effectiveFrom <= asOf);
  eligible.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt));
  return eligible[0] ?? null;
}

/** The rule in force for an agency, a carrier and a kind of save on a date — or null. */
export function resolveRule(rules: RuleRow[], input: { tenantId: string | null; carrierId: string; ruleType: RuleType; asOf: string }): ResolvedRule | null {
  const mine = rules.filter((rule) => rule.carrierId === input.carrierId && rule.ruleType === input.ruleType);
  const agency = input.tenantId ? latest(mine.filter((rule) => rule.tenantId === input.tenantId), input.asOf) : null;
  if (agency && !agency.cleared) return { ...agency, scope: "agency", verified: Boolean(agency.verifiedAt) };
  const platform = latest(mine.filter((rule) => rule.tenantId === null), input.asOf);
  return platform ? { ...platform, scope: "platform", verified: Boolean(platform.verifiedAt) } : null;
}

/**
 * Days left before the carrier closes a policy that is `daysPastDue` behind (LA-4.7). Null when no
 * rule gives a window — never zero, never a default.
 */
export function daysUntilCarrierCloses(rule: Pick<ResolvedRule, "windowDays"> | null, daysPastDue: number): number | null {
  if (!rule || rule.windowDays === null) return null;
  return rule.windowDays - Math.max(0, daysPastDue);
}

export type Gap = { ruleType: RuleType; sentence: string };

/** Each kind of save a carrier has no window for, said as the coverage screen says it. */
export function coverageGaps(input: { carrierName: string; inForce: number; resolved: Record<RuleType, ResolvedRule | null> }): Gap[] {
  return RULE_TYPES.filter((type) => input.resolved[type]?.windowDays === null || !input.resolved[type]).map((type) => ({
    ruleType: type,
    sentence: `${input.carrierName} — ${RULE_TYPE_LABELS[type].window} not set.${input.inForce ? ` ${input.inForce.toLocaleString("en-US")} ${input.inForce === 1 ? "policy" : "policies"} in force; we cannot tell you how long you have to save ${input.inForce === 1 ? "it" : "these"}.` : ""}`,
  }));
}

export type SettingsRow = {
  tenantId: string | null;
  carrierId: string;
  commissionTrigger: (typeof COMMISSION_TRIGGERS)[number] | null;
  expectedLagDays: number | null;
  minimumPayoutCents: number | null;
  toleranceCents: number | null;
  expectedCadence: (typeof CADENCES)[number] | null;
  statementFormat: (typeof STATEMENT_FORMATS)[number] | null;
};

export const SETTING_FIELDS = ["commissionTrigger", "expectedLagDays", "minimumPayoutCents", "toleranceCents", "expectedCadence", "statementFormat"] as const;
export type SettingField = (typeof SETTING_FIELDS)[number];

/** Each of a carrier's settings: the agency's value, else the platform's, else null — and which it was. */
export function resolveSettings(platform: SettingsRow | null, agency: SettingsRow | null): Record<SettingField, { value: string | number | null; scope: "agency" | "platform" | null }> {
  return Object.fromEntries(SETTING_FIELDS.map((field) => {
    const own = agency?.[field] ?? null;
    if (own !== null) return [field, { value: own, scope: "agency" }];
    const shared = platform?.[field] ?? null;
    return [field, { value: shared, scope: shared !== null ? "platform" : null }];
  })) as Record<SettingField, { value: string | number | null; scope: "agency" | "platform" | null }>;
}
