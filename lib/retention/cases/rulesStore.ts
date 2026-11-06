import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { DEFAULT_LADDER_SETTINGS, REASONS, type Reason, type StatusFlag } from "./ladder";
import { LADDER_PENDING_MESSAGE, loadLadderSettings } from "./sync";

/**
 * Settings › Retention › Ladder rules (owner 2026-11-05): an agency switches a reason off, or changes when a
 * deadline counts as urgent and after how many tries a client is unreachable. Stored as overrides on the
 * defaults (`retention_ladder_rule`); a reason back on, or a threshold back to its default, drops its row.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class LadderRulesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LadderRulesError";
  }
}

export type LadderRules = { disabled: Reason[]; urgentDays: number; unreachableAfter: number };

export async function loadLadderRules(tenantId: string): Promise<LadderRules> {
  const s = await loadLadderSettings(tenantId);
  return { disabled: [...s.disabled], urgentDays: s.urgentDays, unreachableAfter: s.unreachableAfter };
}

/**
 * The carrier status words Insurvas has flagged for the ladder (`carrier_status_map.retention_flag`), for the
 * carriers this agency has files from. The map is Insurvas's (one per carrier, kept as their files are read), so
 * an agency sees it, read-only. An unreadable map is an empty list, never a failed page.
 */
export type FlaggedWord = { carrierName: string; word: string; flag: StatusFlag };
export async function loadFlaggedWords(tenantId: string): Promise<FlaggedWord[]> {
  const { data: carriers } = await db().from("policy_current").select("carrier_id").eq("tenant_id", tenantId).limit(5000);
  const ids = [...new Set(((carriers ?? []) as Loose[]).map((c) => c.carrier_id))] as string[];
  if (!ids.length) return [];
  const { data, error } = await db().from("carrier_status_map").select("carrier_status_raw, retention_flag, carriers(name)").eq("file_type", "policies").in("carrier_id", ids).not("retention_flag", "is", null).not("approved_at", "is", null);
  if (error) return [];
  return ((data ?? []) as Loose[])
    .map((r) => ({ carrierName: r.carriers?.name ?? "Carrier", word: r.carrier_status_raw as string, flag: r.retention_flag as StatusFlag }))
    .sort((a, b) => a.carrierName.localeCompare(b.carrierName) || a.word.localeCompare(b.word));
}

export async function saveLadderRules(tenantId: string, userId: string, rules: LadderRules): Promise<{ before: LadderRules; after: LadderRules }> {
  if (!Number.isInteger(rules.urgentDays) || rules.urgentDays < 0 || rules.urgentDays > 60) throw new LadderRulesError("Urgent within: 0 to 60 days.", 400);
  if (!Number.isInteger(rules.unreachableAfter) || rules.unreachableAfter < 1 || rules.unreachableAfter > 20) throw new LadderRulesError("Unreachable after: 1 to 20 tries.", 400);
  const before = await loadLadderRules(tenantId);
  const now = new Date().toISOString();
  const disabled = new Set(rules.disabled.filter((r) => (REASONS as readonly string[]).includes(r)));
  const off = [...disabled].map((reason) => ({ tenant_id: tenantId, reason, enabled: false, params: {}, updated_by: userId, updated_at: now }));
  const custom = rules.urgentDays !== DEFAULT_LADDER_SETTINGS.urgentDays || rules.unreachableAfter !== DEFAULT_LADDER_SETTINGS.unreachableAfter;
  const thresholds = custom ? [{ tenant_id: tenantId, reason: "thresholds", enabled: true, params: { urgent_days: rules.urgentDays, unreachable_after: rules.unreachableAfter }, updated_by: userId, updated_at: now }] : [];
  // Write what is wanted first, then drop what is no longer wanted: a failure never leaves the rules empty.
  const rows = [...off, ...thresholds];
  if (rows.length) {
    const { error } = await db().from("retention_ladder_rule").upsert(rows, { onConflict: "tenant_id,reason" });
    if (error) {
      if (isSchemaGap(error)) throw new LadderRulesError(LADDER_PENDING_MESSAGE, 503);
      throw new Error(`Could not save the ladder rules: ${error.message}`);
    }
  }
  const keep = rows.map((r) => r.reason);
  let drop = db().from("retention_ladder_rule").delete().eq("tenant_id", tenantId);
  if (keep.length) drop = drop.not("reason", "in", `(${keep.join(",")})`);
  const dropped = await drop;
  if (dropped.error) {
    if (isSchemaGap(dropped.error)) throw new LadderRulesError(LADDER_PENDING_MESSAGE, 503);
    throw new Error(`Could not save the ladder rules: ${dropped.error.message}`);
  }
  return { before, after: { disabled: [...disabled], urgentDays: rules.urgentDays, unreachableAfter: rules.unreachableAfter } };
}
