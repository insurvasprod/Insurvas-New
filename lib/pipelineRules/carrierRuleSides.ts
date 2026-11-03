import "server-only";

import { carrierIdsOn } from "@/lib/carriers/agency";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { resolveRule, RULE_TYPES, SETTING_FIELDS, type ResolvedRule, type RuleRow, type RuleType, type SettingField } from "@/lib/ingestion/carrierRules";

/**
 * Setup › Carrier rules (owner decision 4, 2026-11-02): each carrier's rules with Insurvas's value and
 * the agency's own side by side. The agency's own dated rule wins for the agency from its date; clearing
 * it hands the rule back to Insurvas's. Writes go through the shared carrier rules store
 * (lib/ingestion/carrierRulesHttp.ts, agency plane, /api/app/carrier-rules); this only reads, so the
 * screen can show both values where loadCarrierRules shows the one in force.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export type RuleSide = { windowDays: number | null; graceDays: number | null; redraftAttempts: number | null; redraftIntervalDays: number | null; effectiveFrom: string; source: string | null; notes: string | null; verified: boolean } | null;
export type SettingSide = string | number | null;

export type CarrierRuleSides = {
  carrierId: string;
  carrierName: string;
  inForce: number;
  rules: Record<RuleType, { insurvas: RuleSide; yours: RuleSide; inForce: "yours" | "insurvas" | null; upcoming: RuleSide }>;
  settings: Record<SettingField, { insurvas: SettingSide; yours: SettingSide }>;
};

const side = (rule: ResolvedRule | RuleRow | null | undefined): RuleSide =>
  rule ? { windowDays: rule.windowDays, graceDays: rule.graceDays, redraftAttempts: rule.redraftAttempts, redraftIntervalDays: rule.redraftIntervalDays, effectiveFrom: rule.effectiveFrom, source: rule.source, notes: rule.notes, verified: Boolean(rule.verifiedAt) } : null;

const toRule = (row: Loose): RuleRow => ({ id: row.id, tenantId: row.tenant_id, carrierId: row.carrier_id, ruleType: row.rule_type, windowDays: row.window_days, graceDays: row.grace_days, redraftAttempts: row.redraft_attempts, redraftIntervalDays: row.redraft_interval_days, source: row.source, notes: row.notes, effectiveFrom: row.effective_from, createdAt: row.created_at, cleared: row.cleared, verifiedAt: row.verified_at });

const COLUMN: Record<SettingField, string> = { commissionTrigger: "commission_trigger", expectedLagDays: "expected_lag_days", minimumPayoutCents: "minimum_payout_cents", toleranceCents: "tolerance_cents", expectedCadence: "expected_cadence", statementFormat: "statement_format" };

export async function loadCarrierRuleSides(tenantId: string): Promise<{ available: boolean; asOf: string; carriers: CarrierRuleSides[] }> {
  const asOf = await agencyToday(tenantId);
  const [carriers, rules, settings, counts, on] = await Promise.all([
    db().from("carriers").select("id, name").eq("is_active", true).order("name"),
    db().from("carrier_retention_rule").select("*").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).limit(5000),
    db().from("carrier_operating_settings").select("*").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).limit(2000),
    db().rpc("in_force_policy_counts", { p_tenant_id: tenantId }),
    carrierIdsOn(tenantId),
  ]);
  for (const read of [rules, settings]) {
    if (read.error) {
      if (isSchemaGap(read.error)) return { available: false, asOf, carriers: [] };
      throw new Error(`Could not load the carrier rules: ${read.error.message}`);
    }
  }
  if (carriers.error) throw new Error(`Could not load the carriers: ${carriers.error.message}`);
  const rows = ((rules.data ?? []) as Loose[]).map(toRule);
  const inForce = new Map<string, number>(((counts.error ? [] : counts.data ?? []) as Loose[]).map((row) => [row.carrier_id, Number(row.policies)]));
  const settingRows = (settings.data ?? []) as Loose[];

  // LA-0.4: the carriers switched on in Settings › Carriers, plus any still holding in-force policies.
  const result = ((carriers.data ?? []) as Loose[]).filter((carrier) => on.has(carrier.id) || (inForce.get(carrier.id) ?? 0) > 0).map((carrier) => {
    const mine = rows.filter((r) => r.carrierId === carrier.id);
    const ruleSides = Object.fromEntries(RULE_TYPES.map((type) => {
      const platform = resolveRule(mine.filter((r) => r.tenantId === null), { tenantId: null, carrierId: carrier.id, ruleType: type, asOf });
      const resolved = resolveRule(mine, { tenantId, carrierId: carrier.id, ruleType: type, asOf });
      const own = resolved?.scope === "agency" ? resolved : null;
      // An own rule dated after today: shown so a person sees it is coming.
      const ahead = mine.filter((r) => r.tenantId === tenantId && r.ruleType === type && r.effectiveFrom > asOf && !r.cleared).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
      return [type, { insurvas: side(platform), yours: side(own), inForce: resolved ? (resolved.scope === "agency" ? "yours" : "insurvas") : null, upcoming: side(ahead) }];
    })) as CarrierRuleSides["rules"];
    const platformSettings = settingRows.find((s) => s.carrier_id === carrier.id && s.tenant_id === null);
    const ownSettings = settingRows.find((s) => s.carrier_id === carrier.id && s.tenant_id === tenantId);
    const settingSides = Object.fromEntries(SETTING_FIELDS.map((field) => {
      const value = (row: Loose) => (row?.[COLUMN[field]] ?? null) === null ? null : (field === "minimumPayoutCents" || field === "toleranceCents" ? Number(row[COLUMN[field]]) : row[COLUMN[field]]);
      return [field, { insurvas: value(platformSettings), yours: value(ownSettings) }];
    })) as CarrierRuleSides["settings"];
    return { carrierId: carrier.id as string, carrierName: carrier.name as string, inForce: inForce.get(carrier.id) ?? 0, rules: ruleSides, settings: settingSides };
  });
  // The carriers the agency writes with first.
  result.sort((a, b) => b.inForce - a.inForce || a.carrierName.localeCompare(b.carrierName));
  return { available: true, asOf, carriers: result };
}
