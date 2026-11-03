import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { COLUMNS, diff, fromRow, LOCKED, type AccountingSettings } from "./settingsCore";

/**
 * LA-7.9 (Notion sprint, Module 7 — Accounting) · accounting settings, server side. Tenant-scoped,
 * enforced here (a value the browser sends is validated, never trusted). Every change writes one
 * row per field to accounting_setting_change (20261015280000).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const SETTINGS_PENDING_MESSAGE = "Accounting settings need a database update (20261015210000–20261015280000).";

export class SettingsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function loadAccountingSettings(tenantId: string): Promise<AccountingSettings> {
  const { data, error } = await db().from("accounting_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) throw new SettingsError(SETTINGS_PENDING_MESSAGE, 503);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function recentChanges(tenantId: string, limit = 30) {
  const { data } = await db().from("accounting_setting_change").select("field, old_value, new_value, changed_by, changed_at").eq("tenant_id", tenantId).order("changed_at", { ascending: false }).limit(limit);
  return ((data ?? []) as Loose[]).map((c) => ({ field: c.field as string, from: c.old_value, to: c.new_value, by: c.changed_by as string, at: c.changed_at as string }));
}

/** Apply a partial change; returns what changed. Recorded figures are never touched. */
export async function saveAccountingSettings(tenantId: string, by: string, patch: Partial<AccountingSettings>) {
  const before = await loadAccountingSettings(tenantId);
  const after: AccountingSettings = { ...before, ...patch, acquisitionDefaults: { ...before.acquisitionDefaults, ...(patch.acquisitionDefaults ?? {}) } };
  if (!after.taxIdViewerRoles.includes("owner")) throw new SettingsError("The owner can always see tax IDs.");
  const changes = diff(before, after);
  if (!changes.length) return changes;
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_by: by, updated_at: new Date().toISOString() };
  for (const k of Object.keys(COLUMNS) as (keyof AccountingSettings)[]) row[COLUMNS[k]] = after[k];
  const { error } = await db().from("accounting_settings").upsert(row, { onConflict: "tenant_id" });
  if (error) {
    if (isSchemaGap(error)) throw new SettingsError(SETTINGS_PENDING_MESSAGE, 503);
    if (error.code === "23514") throw new SettingsError("One of those values is outside what the setting allows.");
    throw new Error(error.message);
  }
  const { error: le } = await db().from("accounting_setting_change").insert(changes.map((c) => ({ tenant_id: tenantId, field: c.field, old_value: c.from, new_value: c.to, changed_by: by })));
  if (le && !isSchemaGap(le)) throw new Error(le.message);
  return changes;
}

export { LOCKED };
