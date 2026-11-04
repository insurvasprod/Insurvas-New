import "server-only";

import { cache } from "react";

import { carrierIdsOn } from "@/lib/carriers/agency";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { RULE_TYPES, SETTING_FIELDS, type RuleRow, type RuleType, type SettingField } from "@/lib/ingestion/carrierRules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { coverageGapsOf, coverageRules, sortByAffected, type CoverageRule, type Gap } from "./carrierCoverageModel";

/**
 * Setup › Carrier rules (LA-4.17): the coverage list and a carrier's own page, read once for both. One carrier,
 * one row, everything about it: the five windows (tenant override, then Insurvas's, then nothing), the money
 * facts and the file facts, each with whose value it is. Only fields the data model keeps are read; the
 * commissions desk's phone number has no column and is not shown as if it had one. Writes go through
 * /api/app/carrier-rules (lib/ingestion/carrierRulesHttp.ts). Opening either screen writes nothing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export type Owned<T> = { value: T | null; scope: "agency" | "platform" | null; since: string | null };

export type CarrierCoverage = {
  carrierId: string;
  carrierName: string;
  inForce: number;
  rules: Record<RuleType, CoverageRule>;
  gaps: Gap[];
  settings: Record<SettingField, Owned<string | number> & { insurvas: string | number | null; yours: string | number | null }>;
  layouts: Array<{ fileType: "policies" | "commissions"; key: string; name: string | null; version: number | null; scope: "agency" | "platform" }>;
  portal: Owned<string>;
  referencePattern: Owned<string>;
  /** The agency's commissions department for dispute letters (LA-4.15): an address and an optional email. */
  commissionsDesk: { address: string; email: string | null; since: string } | null;
  /** Where in the carrier's portal its report is (LA-4.10), kept by Insurvas. */
  guidance: { whereInPortal: string | null; reportName: string | null; formatHint: string | null } | null;
};

const toRule = (row: Loose): RuleRow => ({ id: row.id, tenantId: row.tenant_id, carrierId: row.carrier_id, ruleType: row.rule_type, windowDays: row.window_days, graceDays: row.grace_days, redraftAttempts: row.redraft_attempts, redraftIntervalDays: row.redraft_interval_days, source: row.source, notes: row.notes, effectiveFrom: row.effective_from, createdAt: row.created_at, cleared: row.cleared, verifiedAt: row.verified_at });

const COLUMN: Record<SettingField, string> = { commissionTrigger: "commission_trigger", expectedLagDays: "expected_lag_days", minimumPayoutCents: "minimum_payout_cents", toleranceCents: "tolerance_cents", expectedCadence: "expected_cadence", statementFormat: "statement_format" };
const day = (stamp: unknown) => (typeof stamp === "string" ? stamp.slice(0, 10) : null);
const quiet = (read: Loose) => (read?.error ? [] : (read?.data ?? [])) as Loose[];

/** Every carrier the agency works with (Settings › Carriers, plus any still holding in-force policies), sorted by policies affected. */
export const loadCarrierCoverage = cache(async (tenantId: string): Promise<{ available: boolean; asOf: string; carriers: CarrierCoverage[]; authors: Record<string, { createdBy: string | null; verifiedBy: string | null }> }> => {
  const asOf = await agencyToday(tenantId);
  const [carriers, rules, settings, counts, on, contacts, assignments, own, guidance] = await Promise.all([
    db().from("carriers").select("id, name, portal_origin, reference_pattern").eq("is_active", true).order("name"),
    db().from("carrier_retention_rule").select("*").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).limit(5000),
    db().from("carrier_operating_settings").select("*").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).limit(2000),
    db().rpc("in_force_policy_counts", { p_tenant_id: tenantId }),
    carrierIdsOn(tenantId),
    db().from("tenant_carrier_commission_contacts").select("carrier_id, address, email, updated_at").eq("tenant_id", tenantId),
    db().from("carrier_layout_assignment").select("tenant_id, carrier_id, file_type, layout_key").or(`tenant_id.eq.${tenantId},tenant_id.is.null`),
    db().from("tenant_carrier_settings").select("carrier_id, portal_origin, reference_pattern, updated_at").eq("tenant_id", tenantId),
    db().from("carrier_portal_guidance").select("carrier_id, where_in_portal, report_name, format_hint"),
  ]);
  for (const read of [rules, settings]) {
    if (read.error) {
      if (isSchemaGap(read.error)) return { available: false, asOf, carriers: [], authors: {} };
      throw new Error(`Could not load the carrier rules: ${read.error.message}`);
    }
  }
  if (carriers.error) throw new Error(`Could not load the carriers: ${carriers.error.message}`);

  const ruleRows = ((rules.data ?? []) as Loose[]).map(toRule);
  const settingRows = (settings.data ?? []) as Loose[];
  const inForce = new Map<string, number>(quiet(counts).map((row) => [row.carrier_id, Number(row.policies)]));
  const contactOf = new Map<string, Loose>(quiet(contacts).map((row) => [row.carrier_id, row]));
  const ownOf = new Map<string, Loose>(quiet(own).map((row) => [row.carrier_id, row]));
  const guideOf = new Map<string, Loose>(quiet(guidance).map((row) => [row.carrier_id, row]));
  const layoutRows = quiet(assignments);

  // The version each layout reads files with: its newest published map (the agency's own over Insurvas's).
  const keys = [...new Set(layoutRows.map((row) => row.layout_key as string))];
  const maps = keys.length ? quiet(await db().from("carrier_layout_map").select("tenant_id, layout_key, name, version, status").in("layout_key", keys).eq("status", "published").or(`tenant_id.eq.${tenantId},tenant_id.is.null`)) : [];
  const mapOf = (key: string) => maps.filter((m) => m.layout_key === key).sort((a, b) => Number(b.tenant_id === tenantId) - Number(a.tenant_id === tenantId) || Number(b.version) - Number(a.version))[0] ?? null;

  const rows = ((carriers.data ?? []) as Loose[]).filter((carrier) => on.has(carrier.id) || (inForce.get(carrier.id) ?? 0) > 0).map((carrier): CarrierCoverage => {
    const count = inForce.get(carrier.id) ?? 0;
    const ruleSet = coverageRules(ruleRows, { tenantId, carrierId: carrier.id, asOf });
    const platform = settingRows.find((s) => s.carrier_id === carrier.id && s.tenant_id === null);
    const agency = settingRows.find((s) => s.carrier_id === carrier.id && s.tenant_id === tenantId);
    const valueOf = (row: Loose, field: SettingField) => {
      const raw = row?.[COLUMN[field]] ?? null;
      return raw === null ? null : field === "minimumPayoutCents" || field === "toleranceCents" || field === "expectedLagDays" ? Number(raw) : String(raw);
    };
    const settingsOf = Object.fromEntries(SETTING_FIELDS.map((field) => {
      const yours = valueOf(agency, field);
      const insurvas = valueOf(platform, field);
      return [field, yours !== null
        ? { value: yours, scope: "agency", since: day(agency?.updated_at), insurvas, yours }
        : { value: insurvas, scope: insurvas !== null ? "platform" : null, since: null, insurvas, yours }];
    })) as CarrierCoverage["settings"];
    const layouts = (["policies", "commissions"] as const).flatMap((fileType) => {
      const assigned = layoutRows.find((row) => row.carrier_id === carrier.id && row.file_type === fileType && row.tenant_id === tenantId) ?? layoutRows.find((row) => row.carrier_id === carrier.id && row.file_type === fileType && row.tenant_id === null);
      if (!assigned) return [];
      const map = mapOf(assigned.layout_key);
      return [{ fileType, key: assigned.layout_key as string, name: (map?.name as string | undefined) ?? null, version: map ? Number(map.version) : null, scope: assigned.tenant_id === tenantId ? "agency" as const : "platform" as const }];
    });
    const mine = ownOf.get(carrier.id);
    const owned = (field: "portal_origin" | "reference_pattern"): Owned<string> => mine?.[field]
      ? { value: mine[field], scope: "agency", since: day(mine.updated_at) }
      : { value: carrier[field] ?? null, scope: carrier[field] ? "platform" : null, since: null };
    const contact = contactOf.get(carrier.id);
    const guide = guideOf.get(carrier.id);
    return {
      carrierId: carrier.id,
      carrierName: carrier.name,
      inForce: count,
      rules: ruleSet,
      gaps: coverageGapsOf(ruleSet, count),
      settings: settingsOf,
      layouts,
      portal: owned("portal_origin"),
      referencePattern: owned("reference_pattern"),
      commissionsDesk: contact ? { address: contact.address, email: contact.email ?? null, since: day(contact.updated_at) ?? asOf } : null,
      guidance: guide ? { whereInPortal: guide.where_in_portal ?? null, reportName: guide.report_name ?? null, formatHint: guide.format_hint ?? null } : null,
    };
  });
  // Who saved and who verified each rule, for a carrier page's history (the agency's own rows only name a person).
  const authors = Object.fromEntries(((rules.data ?? []) as Loose[]).map((row) => [row.id as string, { createdBy: (row.created_by as string | null) ?? null, verifiedBy: (row.verified_by as string | null) ?? null }]));
  return { available: true, asOf, carriers: sortByAffected(rows), authors };
});

export type RuleHistoryLine = { id: string; ruleType: RuleType; effectiveFrom: string; createdAt: string; scope: "agency" | "platform"; cleared: boolean; windowDays: number | null; graceDays: number | null; redraftAttempts: number | null; redraftIntervalDays: number | null; source: string | null; notes: string | null; verifiedAt: string | null; by: string | null; verifiedBy: string | null };

/**
 * One carrier's page: its coverage row, the carriers before and after it in the list (‹ Carrier ›), and each
 * window's history with who saved and verified it. Null when the carrier is not one the agency works with.
 */
export async function loadCarrierRulesPage(tenantId: string, carrierId: string) {
  const view = await loadCarrierCoverage(tenantId);
  if (!view.available) return { available: false as const, asOf: view.asOf };
  const index = view.carriers.findIndex((c) => c.carrierId === carrierId);
  if (index < 0) return { available: true as const, asOf: view.asOf, carrier: null };
  const carrier = view.carriers[index];
  const lines = RULE_TYPES.flatMap((type) => carrier.rules[type].history);
  const userIds = [...new Set(lines.flatMap((row) => [view.authors[row.id]?.createdBy, view.authors[row.id]?.verifiedBy]).filter((id): id is string => Boolean(id)))];
  const { data: users } = userIds.length ? await db().from("users").select("id, name, email").in("id", userIds) : { data: [] };
  const nameOf = new Map<string, string>(((users ?? []) as Loose[]).map((u) => [u.id, u.name || u.email || "Someone"]));
  const author = (id: string, key: "createdBy" | "verifiedBy") => nameOf.get(view.authors[id]?.[key] ?? "") ?? null;
  const history = Object.fromEntries(RULE_TYPES.map((type) => [type, carrier.rules[type].history.map((row): RuleHistoryLine => ({
    id: row.id, ruleType: type, effectiveFrom: row.effectiveFrom, createdAt: row.createdAt, scope: row.tenantId ? "agency" : "platform", cleared: row.cleared,
    windowDays: row.windowDays, graceDays: row.graceDays, redraftAttempts: row.redraftAttempts, redraftIntervalDays: row.redraftIntervalDays, source: row.source, notes: row.notes, verifiedAt: row.verifiedAt,
    by: row.tenantId ? author(row.id, "createdBy") : "Insurvas",
    verifiedBy: row.verifiedAt ? (row.tenantId ? author(row.id, "verifiedBy") : "Insurvas") : null,
  }))])) as Record<RuleType, RuleHistoryLine[]>;
  const step = (offset: number) => {
    const other = view.carriers[(index + offset + view.carriers.length) % view.carriers.length];
    return view.carriers.length > 1 && other ? { carrierId: other.carrierId, carrierName: other.carrierName } : null;
  };
  return { available: true as const, asOf: view.asOf, carrier, history, previous: step(-1), next: step(1), position: index + 1, total: view.carriers.length };
}
