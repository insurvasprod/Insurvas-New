import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { coverageGaps, resolveRule, resolveSettings, RULE_TYPES, type Gap, type ResolvedRule, type RuleRow, type RuleSource, type RuleType, type SettingField, type SettingsRow } from "./carrierRules";
import { refreshPolicyCurrent } from "./policyCurrentStore";

/**
 * LA-4.17 (Notion sprint) · carrier rules and settings, server side, for two planes: an agency (its
 * own overrides, over the platform's) and staff (the platform defaults). One carrier, one row: the
 * rules, the carrier's operating settings, and the settings kept elsewhere (the commissions address,
 * the layout map, the portal and reference pattern) shown with them.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export type RulesScope = { plane: "agency"; tenantId: string; userId: string } | { plane: "platform"; adminId: string };

export class CarrierRulesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CarrierRulesError";
  }
}

export const CARRIER_RULES_PENDING_MESSAGE = "Carrier rules need a database update (20261008150000).";

function fail(error: { message: string; code?: string }, fallback: string): never {
  if (isSchemaGap(error)) throw new CarrierRulesError(CARRIER_RULES_PENDING_MESSAGE, 503);
  if (error.code === "P0001") throw new CarrierRulesError(error.message, 409);
  if (error.code === "23514") throw new CarrierRulesError("Those numbers are outside what a carrier rule can hold.", 400);
  throw new Error(`${fallback}: ${error.message}`);
}

/**
 * The agency's own calendar day (its profile's time zone), so a rule saved in a US evening is dated
 * today, as refresh_policy_current dates it — not tomorrow, as UTC would. The platform plane: UTC.
 */
async function today(scope?: RulesScope): Promise<string> {
  if (scope?.plane !== "agency") return new Date().toISOString().slice(0, 10);
  const { data } = await db().from("agency_profiles").select("timezone").eq("tenant_id", scope.tenantId).maybeSingle();
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: (data?.timezone as string | null) ?? "UTC" });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function toRule(row: Loose): RuleRow {
  return { id: row.id, tenantId: row.tenant_id, carrierId: row.carrier_id, ruleType: row.rule_type, windowDays: row.window_days, graceDays: row.grace_days, redraftAttempts: row.redraft_attempts, redraftIntervalDays: row.redraft_interval_days, source: row.source, notes: row.notes, effectiveFrom: row.effective_from, createdAt: row.created_at, cleared: row.cleared, verifiedAt: row.verified_at };
}

function toSettings(row: Loose): SettingsRow {
  return { tenantId: row.tenant_id, carrierId: row.carrier_id, commissionTrigger: row.commission_trigger, expectedLagDays: row.expected_lag_days, minimumPayoutCents: row.minimum_payout_cents === null ? null : Number(row.minimum_payout_cents), toleranceCents: row.tolerance_cents === null ? null : Number(row.tolerance_cents), expectedCadence: row.expected_cadence, statementFormat: row.statement_format };
}

export type CarrierRulesRow = {
  carrierId: string;
  carrierName: string;
  carrierCode: string;
  inForce: number | null;
  rules: Record<RuleType, ResolvedRule | null>;
  gaps: Gap[];
  settings: ReturnType<typeof resolveSettings>;
  elsewhere: { commissionsAddress: boolean; layoutKey: string | null; portalOrigin: string | null; referencePattern: string | null };
  /** The agency's commissions department contact for dispute letters (LA-4.15), on the same screen (LA-4.17). */
  commissionsContact: { address: string; email: string | null } | null;
  /** Where in the carrier's portal its files are (LA-4.10), platform-kept; null when none is written. */
  guidance: { whereInPortal: string | null; reportName: string | null; formatHint: string | null; notes: string | null } | null;
};

export async function loadCarrierRules(scope: RulesScope): Promise<{ available: boolean; carriers: CarrierRulesRow[]; asOf: string }> {
  const asOf = await today(scope);
  const tenantId = scope.plane === "agency" ? scope.tenantId : null;
  const scoped = (query: Loose) => (tenantId ? query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`) : query.is("tenant_id", null));
  const [carriers, rules, settings, counts, contacts, assignments, overrides, guidance] = await Promise.all([
    db().from("carriers").select("id, code, name, portal_origin, reference_pattern").eq("is_active", true).order("name"),
    scoped(db().from("carrier_retention_rule").select("*")).limit(5000),
    scoped(db().from("carrier_operating_settings").select("*")).limit(2000),
    tenantId ? db().rpc("in_force_policy_counts", { p_tenant_id: tenantId }) : Promise.resolve({ data: [], error: null }),
    tenantId ? db().from("tenant_carrier_commission_contacts").select("carrier_id, address, email").eq("tenant_id", tenantId) : Promise.resolve({ data: [], error: null }),
    scoped(db().from("carrier_layout_assignment").select("tenant_id, carrier_id, layout_key")),
    tenantId ? db().from("tenant_carrier_settings").select("carrier_id, portal_origin, reference_pattern").eq("tenant_id", tenantId) : Promise.resolve({ data: [], error: null }),
    db().from("carrier_portal_guidance").select("carrier_id, where_in_portal, report_name, format_hint, notes"),
  ]);
  for (const read of [rules, settings]) {
    if (read.error) {
      if (isSchemaGap(read.error)) return { available: false, carriers: [], asOf };
      fail(read.error, "Could not load carrier rules");
    }
  }
  if (carriers.error) fail(carriers.error, "Could not load carriers");
  const ruleRows: RuleRow[] = (rules.data ?? []).map(toRule);
  const settingRows: SettingsRow[] = (settings.data ?? []).map(toSettings);
  const inForce = new Map<string, number>(((counts.data ?? []) as Loose[]).map((row) => [row.carrier_id, Number(row.policies)]));
  const contactOf = new Map<string, Loose>(((contacts.data ?? []) as Loose[]).map((row) => [row.carrier_id, row]));
  const guideOf = new Map<string, Loose>(((guidance.error ? [] : guidance.data ?? []) as Loose[]).map((row) => [row.carrier_id, row]));
  const layouts = (assignments.data ?? []) as Loose[];
  const own = new Map(((overrides.data ?? []) as Loose[]).map((row) => [row.carrier_id, row]));

  return {
    available: true,
    asOf,
    carriers: ((carriers.data ?? []) as Loose[]).map((carrier) => {
      const resolved = Object.fromEntries(RULE_TYPES.map((type) => [type, resolveRule(ruleRows, { tenantId, carrierId: carrier.id, ruleType: type, asOf })])) as Record<RuleType, ResolvedRule | null>;
      const count = tenantId ? inForce.get(carrier.id) ?? 0 : null;
      const layout = layouts.find((row) => row.carrier_id === carrier.id && row.tenant_id === tenantId) ?? layouts.find((row) => row.carrier_id === carrier.id && row.tenant_id === null);
      return {
        carrierId: carrier.id,
        carrierName: carrier.name,
        carrierCode: carrier.code,
        inForce: count,
        rules: resolved,
        gaps: coverageGaps({ carrierName: carrier.name, inForce: count ?? 0, resolved }),
        settings: resolveSettings(settingRows.find((row) => row.carrierId === carrier.id && row.tenantId === null) ?? null, tenantId ? settingRows.find((row) => row.carrierId === carrier.id && row.tenantId === tenantId) ?? null : null),
        elsewhere: {
          commissionsAddress: contactOf.has(carrier.id),
          layoutKey: layout?.layout_key ?? null,
          portalOrigin: own.get(carrier.id)?.portal_origin ?? carrier.portal_origin ?? null,
          referencePattern: own.get(carrier.id)?.reference_pattern ?? carrier.reference_pattern ?? null,
        },
        commissionsContact: contactOf.has(carrier.id) ? { address: contactOf.get(carrier.id).address, email: contactOf.get(carrier.id).email ?? null } : null,
        guidance: guideOf.has(carrier.id) ? { whereInPortal: guideOf.get(carrier.id).where_in_portal, reportName: guideOf.get(carrier.id).report_name, formatHint: guideOf.get(carrier.id).format_hint, notes: guideOf.get(carrier.id).notes } : null,
      };
    }),
  };
}

export type RuleInput = { carrierId: string; ruleType: RuleType; windowDays: number | null; graceDays: number | null; redraftAttempts: number | null; redraftIntervalDays: number | null; source: RuleSource; notes: string | null; effectiveFrom: string | null };

async function knownCarrier(carrierId: string) {
  const { data } = await db().from("carriers").select("id").eq("id", carrierId).eq("is_active", true).maybeSingle();
  if (!data) throw new CarrierRulesError("Choose a carrier from the library.", 400);
}

/**
 * A rule change moves the countdowns of that carrier's policies (LA-4.7) — for one agency, or for
 * every agency when it is the platform's. The rule is saved either way; if the recount fails, the
 * daily refresh catches up.
 */
async function recount(tenantId: string | null, carrierId: string) {
  try {
    await refreshPolicyCurrent({ tenantId, carrierId });
  } catch (error) {
    console.error("[carrier-rules] recount", error);
  }
}

/** A new rule from a date — the only way a rule changes. */
export async function addRule(scope: RulesScope, input: RuleInput): Promise<string> {
  await knownCarrier(input.carrierId);
  if (input.windowDays === null && input.graceDays === null && input.redraftAttempts === null) throw new CarrierRulesError("Enter at least the window, the grace or the redraft attempts.", 400);
  const { data, error } = await db().from("carrier_retention_rule").insert({
    tenant_id: scope.plane === "agency" ? scope.tenantId : null,
    carrier_id: input.carrierId,
    rule_type: input.ruleType,
    window_days: input.windowDays,
    grace_days: input.graceDays,
    redraft_attempts: input.redraftAttempts,
    redraft_interval_days: input.redraftIntervalDays,
    source: input.source,
    notes: input.notes,
    effective_from: input.effectiveFrom ?? (await today(scope)),
    created_by: scope.plane === "agency" ? scope.userId : null,
    created_by_admin: scope.plane === "platform" ? scope.adminId : null,
  }).select("id").single();
  if (error) fail(error, "Could not save the rule");
  await recount(scope.plane === "agency" ? scope.tenantId : null, input.carrierId);
  return data.id;
}

/** Hands an agency's rule back to the platform's, from today. */
export async function clearOverride(scope: Extract<RulesScope, { plane: "agency" }>, carrierId: string, ruleType: RuleType): Promise<string> {
  const { data, error } = await db().from("carrier_retention_rule").insert({ tenant_id: scope.tenantId, carrier_id: carrierId, rule_type: ruleType, cleared: true, effective_from: await today(scope), created_by: scope.userId }).select("id").single();
  if (error) fail(error, "Could not clear the override");
  await recount(scope.tenantId, carrierId);
  return data.id;
}

/** Marks a rule verified, once. An agency verifies its own rules; staff verify the platform's. */
export async function verifyRule(scope: RulesScope, ruleId: string): Promise<void> {
  let query = db().from("carrier_retention_rule").update({ verified_at: new Date().toISOString(), verified_by: scope.plane === "agency" ? scope.userId : null, verified_by_admin: scope.plane === "platform" ? scope.adminId : null }).eq("id", ruleId).is("verified_at", null).eq("cleared", false);
  query = scope.plane === "agency" ? query.eq("tenant_id", scope.tenantId) : query.is("tenant_id", null);
  const { data, error } = await query.select("id");
  if (error) fail(error, "Could not verify the rule");
  if (!data?.length) throw new CarrierRulesError(scope.plane === "agency" ? "Only this agency's own, unverified rules can be verified here." : "Only an unverified platform rule can be verified.", 409);
}

const COLUMN: Record<SettingField, string> = { commissionTrigger: "commission_trigger", expectedLagDays: "expected_lag_days", minimumPayoutCents: "minimum_payout_cents", toleranceCents: "tolerance_cents", expectedCadence: "expected_cadence", statementFormat: "statement_format" };

/** Saves a carrier's operating settings for this scope (null clears a field back to the platform's). */
export async function saveCarrierSettings(scope: RulesScope, carrierId: string, values: Partial<Record<SettingField, string | number | null>>): Promise<void> {
  await knownCarrier(carrierId);
  const row: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: scope.plane === "agency" ? scope.userId : null, updated_by_admin: scope.plane === "platform" ? scope.adminId : null };
  for (const [field, value] of Object.entries(values)) row[COLUMN[field as SettingField]] = value;
  const tenantId = scope.plane === "agency" ? scope.tenantId : null;
  let find = db().from("carrier_operating_settings").select("id").eq("carrier_id", carrierId);
  find = tenantId ? find.eq("tenant_id", tenantId) : find.is("tenant_id", null);
  const { data: existing, error } = await find.maybeSingle();
  if (error) fail(error, "Could not read the carrier's settings");
  const write = existing
    ? db().from("carrier_operating_settings").update(row).eq("id", existing.id)
    : db().from("carrier_operating_settings").insert({ ...row, tenant_id: tenantId, carrier_id: carrierId });
  const { error: writeError } = await write;
  if (writeError) fail(writeError, "Could not save the carrier's settings");
  // A changed trigger or lag moves when commission is due: the agency's expected figures follow it
  // (their amounts stay as computed, 20261009200000), and its discrepancies are found again.
  if (tenantId && ("commissionTrigger" in values || "expectedLagDays" in values)) {
    try {
      const { computeExpected } = await import("./expectedCommissionStore");
      const { runDetection } = await import("./discrepancyStore");
      await computeExpected(tenantId, carrierId);
      await runDetection(tenantId);
    } catch (failure) {
      console.error("[carrier-rules] expected commission could not be recomputed after a settings change:", failure);
    }
  }
}
